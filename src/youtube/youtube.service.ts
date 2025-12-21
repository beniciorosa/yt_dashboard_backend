import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class YoutubeService {
    private readonly logger = new Logger(YoutubeService.name);
    private apiKey: string;
    private baseUrl = 'https://www.googleapis.com/youtube/v3';
    private analyticsUrl = 'https://youtubeanalytics.googleapis.com/v2/reports';
    private supabase: SupabaseClient;

    constructor(private configService: ConfigService) {
        const key = this.configService.get<string>('YOUTUBE_API_KEY');
        const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
        const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

        if (!key) throw new Error('YOUTUBE_API_KEY not found');
        if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials not found');

        this.apiKey = key;
        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    async proxy(endpoint: string, params: Record<string, string>) {
        const url = new URL(`${this.baseUrl}/${endpoint}`);

        Object.keys(params).forEach(key => {
            if (key !== 'endpoint') {
                url.searchParams.append(key, params[key]);
            }
        });

        url.searchParams.append('key', this.apiKey);

        try {
            const response = await fetch(url.toString());
            if (!response.ok) {
                const error = await response.json();
                throw new Error(JSON.stringify(error));
            }
            return await response.json();
        } catch (error) {
            console.error(`Error proxying to YouTube ${endpoint}:`, error);
            throw error;
        }
    }

    async proxyAction(token: string, method: string, endpoint: string, data?: any, params?: any) {
        const url = new URL(`${this.baseUrl}/${endpoint}`);

        // Append query params if any
        if (params) {
            Object.keys(params).forEach(key => {
                url.searchParams.append(key, params[key]);
            });
        }

        console.log(`[ProxyAction] ${method} ${url.toString()}`);

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        };

        const hasBody = data !== undefined && data !== null && method !== 'GET' && method !== 'HEAD';

        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        } else if (method === 'POST') {
            // Essential for endpoints like comments/rate that are POST but empty body
            headers['Content-Length'] = '0';
        }

        console.log(`[ProxyAction] ${method} ${url.toString()} | HasBody: ${hasBody}`);

        try {
            const response = await fetch(url.toString(), {
                method: method,
                headers: headers,
                body: hasBody ? JSON.stringify(data) : undefined
            });

            const status = response.status;
            console.log(`[ProxyAction] Status: ${status}`);

            // 1. Safely read body ONCE
            const rawBody = await response.text();

            // 2. Try parse JSON
            let jsonBody;
            try {
                jsonBody = rawBody ? JSON.parse(rawBody) : null;
            } catch {
                jsonBody = rawBody; // Fallback to text
            }


            if (!response.ok) {
                console.error(`[ProxyAction] Upstream Error (${status}) RawBody:`, rawBody);
                const errorMessage = jsonBody ? JSON.stringify(jsonBody) : (rawBody || `YouTube API Error ${status}`);
                throw new Error(errorMessage);
            }

            if (status === 204) {
                return { success: true };
            }

            return jsonBody || { success: true };

        } catch (error) {
            console.error(`Error proxying action to YouTube ${endpoint}:`, error);
            throw error;
        }
    }
    // --- OAUTH & SYNC LOGIC ---

    async saveRefreshToken(channelId: string, refreshToken: string) {
        const { error } = await this.supabase
            .from('yt_auth')
            .upsert({ channel_id: channelId, refresh_token: refreshToken, updated_at: new Date().toISOString() });

        if (error) throw error;
        return { success: true };
    }

    async refreshAccessToken(channelId: string) {
        const { data, error } = await this.supabase
            .from('yt_auth')
            .select('refresh_token')
            .eq('channel_id', channelId)
            .single();

        if (error || !data) throw new Error('Refresh token not found for channel');

        const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
        const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId || '',
                client_secret: clientSecret || '',
                refresh_token: data.refresh_token,
                grant_type: 'refresh_token',
            } as any),
        });

        const result = await response.json();
        if (!response.ok) throw new Error(`Failed to refresh token: ${JSON.stringify(result)}`);

        return result.access_token;
    }

    async syncDetailedEngagement(channelId: string) {
        this.logger.log(`Starting detailed sync for channel: ${channelId}`);
        const token = await this.refreshAccessToken(channelId);

        // 1. Get all videos from our DB
        const { data: videos, error } = await this.supabase
            .from('yt_myvideos')
            .select('video_id')
            .eq('channel_id', channelId);

        if (error) throw error;
        if (!videos || videos.length === 0) return { message: 'No videos found in DB' };

        const videoIds = videos.map(v => v.video_id);
        this.logger.log(`Found ${videoIds.length} videos to sync.`);

        // Process in batches of 50 (API limit)
        for (let i = 0; i < videoIds.length; i += 50) {
            const batch = videoIds.slice(i, i + 50);
            await this.processDetailedBatch(batch, token);
        }

        return { success: true, processedCount: videoIds.length };
    }

    private async processDetailedBatch(videoIds: string[], token: string) {
        const idsStr = videoIds.join(',');
        const today = new Date().toISOString().split('T')[0];

        // A. Fetch Analytics (Retenção e Saúde)
        const metrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,cardImpressions,cardClickRate';
        const url = `${this.analyticsUrl}?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=${metrics}&dimensions=video&filters=video==${idsStr}`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const errorText = await res.text();
            this.logger.error(`Analytics API Error: ${errorText}`);
            // Se falhar o lote, tentamos continuar o processo para as fontes de tráfego, ou pulamos
            return;
        }

        const data = await res.json();
        const rows = data.rows || [];

        // Update yt_myvideos with summary metrics
        for (const row of rows) {
            const [vid, views, minutes, avgDur, avgPerc, subs, cardImp, cardClick] = row;
            const { error: updateError } = await this.supabase.from('yt_myvideos').update({
                analytics_views: views,
                estimated_minutes_watched: minutes,
                average_view_duration_seconds: avgDur,
                average_view_percentage: avgPerc,
                subscribers_gained: subs,
                impressions: cardImp,
                click_through_rate: cardClick,
                end_screen_ctr: 0, // Removido por incompatibilidade de métrica no momento
                last_updated: new Date().toISOString()
            }).eq('video_id', vid);

            if (updateError) {
                this.logger.error(`Error updating yt_myvideos for ${vid}: ${updateError.message}`);
            }
        }

        // C. Fetch Traffic Sources
        await this.syncTrafficSources(videoIds, token);
    }

    private async syncTrafficSources(videoIds: string[], token: string) {
        const today = new Date().toISOString().split('T')[0];

        for (const vid of videoIds) {
            const url = `${this.analyticsUrl}?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceType&filters=video==${vid}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) continue;

            const data = await res.json();
            const rows = data.rows || [];

            const trafficRows = rows.map(row => ({
                video_id: vid,
                source_type: row[0],
                views: row[1],
                watch_time_minutes: row[2],
                source_detail: '' // Preencher com vazio para evitar erro de NOT NULL se existir
            }));

            if (trafficRows.length > 0) {
                const { error: delError } = await this.supabase.from('yt_video_traffic_details').delete().eq('video_id', vid);
                if (delError) this.logger.error(`Error deleting traffic for ${vid}: ${delError.message}`);

                const { error: insError } = await this.supabase.from('yt_video_traffic_details').insert(trafficRows);
                if (insError) this.logger.error(`Error inserting traffic for ${vid}: ${insError.message}`);
            }
        }
    }
}
