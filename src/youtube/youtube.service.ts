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

    async syncDetailedEngagement(channelId: string, specificVideoIds?: string[], includeDeepDive = false) {
        this.logger.log(`Starting detailed sync for channel: ${channelId}`);
        const token = await this.refreshAccessToken(channelId);
        const today = new Date().toISOString().split('T')[0];
        // YouTube Analytics costuma ter atraso de 2-3 dias para dados detalhados (Retenção/Keywords)
        const reliableEndDate = new Date(new Date().getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        let videoIds = specificVideoIds;
        let shouldDeepDive = includeDeepDive;

        if (!videoIds) {
            const { data: videos, error } = await this.supabase
                .from('yt_myvideos')
                .select('video_id')
                .eq('channel_id', channelId);

            if (error) throw error;
            if (!videos || videos.length === 0) return { message: 'No videos found in DB' };
            videoIds = videos.map(v => v.video_id);
            // Se não passou IDs específicos, assume que quer o deep dive como padrão
            if (specificVideoIds === undefined && includeDeepDive === undefined) {
                shouldDeepDive = true;
            }
        }

        this.logger.log(`Processing ${videoIds.length} videos. Deep Dive: ${shouldDeepDive}`);

        // 1. Tier 1: Process batches of 50 for Health Summary & Traffic Type Aggregates
        for (let i = 0; i < videoIds.length; i += 50) {
            const batch = videoIds.slice(i, i + 50);
            await this.processBatchTier1(batch, token, today);
        }

        // 2. Tier 2: Deep Dive for Top Videos (Traffic Details & Retention)
        if (shouldDeepDive) {
            const { data: topVideos } = await this.supabase
                .from('yt_myvideos')
                .select('video_id, title, analytics_views')
                .eq('channel_id', channelId)
                .order('analytics_views', { ascending: false, nullsFirst: false })
                .limit(5);

            if (topVideos && topVideos.length > 0) {
                this.logger.log(`[Tier2] Found ${topVideos.length} top videos for deep dive.`);
                const topIds = topVideos.map(v => v.video_id);
                // Usamos reliableEndDate para garantir que o YouTube tenha tempo de processar os dados detalhados
                await this.processBatchTier2(topIds, token, reliableEndDate, channelId);
            } else {
                this.logger.log(`[Tier2] No top videos found with views for deep dive.`);
            }
        }

        return { success: true, processedCount: videoIds.length };
    }

    private async processBatchTier1(videoIds: string[], token: string, today: string) {
        this.logger.log(`[Tier1] Processing batch of ${videoIds.length} videos`);
        const idsStr = videoIds.join(',');

        // A. Health Summary (Batch)
        const metrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,cardImpressions,cardClickRate';
        const url = `${this.analyticsUrl}?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=${metrics}&dimensions=video&filters=video==${idsStr}`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
            const data = await res.json();
            const rows = data.rows || [];
            this.logger.log(`[Tier1] Health summary rows: ${rows.length}`);
            if (rows.length === 0) {
                this.logger.log(`[Tier1] No health summary data found for batch.`);
            }
            for (const row of rows) {
                const [vid, vws, mins, avgD, avgP, subs, cImp, cClck] = row;
                const { error } = await this.supabase.from('yt_myvideos').update({
                    analytics_views: vws,
                    estimated_minutes_watched: mins,
                    average_view_duration_seconds: avgD,
                    average_view_percentage: avgP,
                    subscribers_gained: subs,
                    impressions: cImp,
                    click_through_rate: cClck,
                    last_updated: new Date().toISOString()
                }).eq('video_id', vid);
                if (error) this.logger.error(`[Tier1] Update error for ${vid}: ${error.message}`);
            }
        } else {
            this.logger.error(`[Tier1] API Error (Health): ${res.status}`);
        }

        // B. Traffic Types Aggregate (Batch)
        const trafficUrl = `${this.analyticsUrl}?ids=channel==MINE&startDate=2005-01-01&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=video,insightTrafficSourceType&filters=video==${idsStr}`;
        const tRes = await fetch(trafficUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (tRes.ok) {
            const tData = await tRes.json();
            const tRows = tData.rows || [];
            this.logger.log(`[Tier1] Traffic source rows: ${tRows.length}`);
            if (tRows.length === 0) {
                this.logger.log(`[Tier1] No traffic source data found for batch.`);
            }
            const dbRows = tRows.map(r => ({
                video_id: r[0],
                source_type: r[1],
                views: r[2],
                watch_time_minutes: r[3],
                source_detail: ''
            }));

            for (const vid of videoIds) {
                await this.supabase.from('yt_video_traffic_details').delete().eq('video_id', vid).eq('source_detail', '');
            }
            if (dbRows.length > 0) {
                const { error } = await this.supabase.from('yt_video_traffic_details').insert(dbRows);
                if (error) this.logger.error(`[Tier1] Insert error (Traffic): ${error.message}`);
            }
        } else {
            this.logger.error(`[Tier1] API Error (Traffic): ${tRes.status}`);
        }
    }

    private async processBatchTier2(videoIds: string[], token: string, today: string, channelId: string) {
        this.logger.log(`[Tier2] Starting Deep Dive for ${videoIds.length} videos on channel ${channelId}`);
        const startDate = '2022-01-01'; // Mais seguro para métricas detalhadas

        for (const vid of videoIds) {
            const encodedVid = encodeURIComponent(vid);

            // A. Retention Curve
            const retUrl = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=${startDate}&endDate=${today}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${encodedVid}`;
            const retRes = await fetch(retUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (retRes.ok) {
                const retData = await retRes.json();
                const rows = retData.rows || [];
                this.logger.log(`[Tier2] Retention curve for ${vid}: ${rows.length} rows`);
                if (rows.length === 0) {
                    this.logger.log(`[Tier2] No retention curve data for ${vid}. Response: ${JSON.stringify(retData)}`);
                }
                const retRows = rows.map(r => ({
                    video_id: vid,
                    relative_time: parseFloat(r[0]),
                    retention_percentage: parseFloat(r[1]) * 100
                }));
                if (retRows.length > 0) {
                    await this.supabase.from('yt_video_retention_curve').delete().eq('video_id', vid);
                    const { error } = await this.supabase.from('yt_video_retention_curve').insert(retRows);
                    if (error) this.logger.error(`[Tier2] DB Error (Retention) for ${vid}: ${error.message}`);
                }
            } else {
                this.logger.error(`[Tier2] API Error (Retention) for ${vid}: ${retRes.status}`);
            }

            // B. Search Keywords Detail
            const detailUrl = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=${startDate}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceDetail&filters=video==${encodedVid};insightTrafficSourceType==YT_SEARCH`;
            const dRes = await fetch(detailUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (dRes.ok) {
                const dData = await dRes.json();
                const rows = dData.rows || [];
                this.logger.log(`[Tier2] YT_SEARCH details for ${vid}: ${rows.length} rows`);
                if (rows.length === 0) {
                    this.logger.log(`[Tier2] No YT_SEARCH details for ${vid}. Response: ${JSON.stringify(dData)}`);
                }
                const dRows = rows.slice(0, 15).map(r => ({
                    video_id: vid,
                    source_type: 'YT_SEARCH',
                    source_detail: r[0],
                    views: r[1],
                    watch_time_minutes: r[2]
                }));
                if (dRows.length > 0) {
                    await this.supabase.from('yt_video_traffic_details').delete().eq('video_id', vid).eq('source_type', 'YT_SEARCH').neq('source_detail', '');
                    const { error } = await this.supabase.from('yt_video_traffic_details').insert(dRows);
                    if (error) this.logger.error(`[Tier2] DB Error (Search) for ${vid}: ${error.message}`);
                }
            } else {
                this.logger.error(`[Tier2] API Error (Search) for ${vid}: ${dRes.status}`);
            }

            // C. Suggested Videos Detail
            const suggUrl = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=${startDate}&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=insightTrafficSourceDetail&filters=video==${encodedVid};insightTrafficSourceType==RELATED_VIDEO`;
            const sRes = await fetch(suggUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (sRes.ok) {
                const sData = await sRes.json();
                const rows = sData.rows || [];
                this.logger.log(`[Tier2] RELATED_VIDEO details for ${vid}: ${rows.length} rows`);
                if (rows.length === 0) {
                    this.logger.log(`[Tier2] No RELATED_VIDEO details for ${vid}. Response: ${JSON.stringify(sData)}`);
                }
                const sRows = rows.slice(0, 15).map(r => ({
                    video_id: vid,
                    source_type: 'RELATED_VIDEO',
                    source_detail: r[0],
                    views: r[1],
                    watch_time_minutes: r[2]
                }));
                if (sRows.length > 0) {
                    await this.supabase.from('yt_video_traffic_details').delete().eq('video_id', vid).eq('source_type', 'RELATED_VIDEO').neq('source_detail', '');
                    const { error } = await this.supabase.from('yt_video_traffic_details').insert(sRows);
                    if (error) this.logger.error(`[Tier2] DB Error (Suggested) for ${vid}: ${error.message}`);
                }
            }
        }
    }
}
