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

    async syncDetailedEngagement(channelId: string, specificVideoIds?: string[], includeDeepDive = true) {
        this.logger.log(`Starting detailed sync for channel: ${channelId}`);
        const token = await this.refreshAccessToken(channelId);
        const today = new Date().toISOString().split('T')[0];
        // YouTube Analytics costuma ter atraso de 2-3 dias para dados detalhados (Retenção/Keywords)
        // Usamos D-4 para garantir que o dado já está consolidado no servidor do Google
        const reliableEndDate = new Date(new Date().getTime() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        let videoIds = specificVideoIds;
        let shouldDeepDive = includeDeepDive;

        if (!videoIds) {
            this.logger.log(`[Discovery] Fetching all videos from uploads playlist for channel: ${channelId}`);
            // A. Pega o ID da playlist de Uploads
            const channelRes = await fetch(`${this.baseUrl}/channels?part=contentDetails&id=${channelId}&key=${this.apiKey}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const channelData = await channelRes.json();
            const uploadsId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

            if (!uploadsId) throw new Error('Could not find uploads playlist for channel');

            // B. Busca todos os vídeos da playlist
            videoIds = [];
            let nextPageToken = '';
            do {
                const url = `${this.baseUrl}/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=50&key=${this.apiKey}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
                const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                const data = await res.json();
                if (data.items) {
                    videoIds.push(...data.items.map((i: any) => i.snippet.resourceId.videoId));
                }
                nextPageToken = data.nextPageToken;
            } while (nextPageToken);

            this.logger.log(`[Discovery] Found ${videoIds.length} videos in uploads playlist.`);

            // Se não passou IDs específicos, assume que quer o deep dive como padrão
            if (specificVideoIds === undefined && includeDeepDive === undefined) {
                shouldDeepDive = true;
            }
        }

        this.logger.log(`Processing ${videoIds.length} videos. Deep Dive: ${shouldDeepDive}`);

        // 1. Tier 1: Process batches of 50 for Health Summary & Traffic Type Aggregates
        for (let i = 0; i < videoIds.length; i += 50) {
            const batch = videoIds.slice(i, i + 50);
            await this.processBatchTier1(batch, token, today, channelId);
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

    private parseDurationSeconds(duration: string): number {
        const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!matches) return 0;
        const hours = parseInt(matches[1] || '0');
        const minutes = parseInt(matches[2] || '0');
        const seconds = parseInt(matches[3] || '0');
        return hours * 3600 + minutes * 60 + seconds;
    }

    private async processBatchTier1(videoIds: string[], token: string, today: string, channelId: string) {
        this.logger.log(`[Tier1] Processing batch of ${videoIds.length} videos`);
        const idsStr = videoIds.join(',');

        const videoMap = new Map<string, any>();

        // 0. Metadata Sync (Data API)
        const dataUrl = `${this.baseUrl}/videos?part=snippet,contentDetails,statistics,status&id=${idsStr}&key=${this.apiKey}`;
        const dataRes = await fetch(dataUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (dataRes.ok) {
            const videoData = await dataRes.json();
            const items = videoData.items || [];

            for (const item of items) {
                videoMap.set(item.id, {
                    video_id: item.id,
                    channel_id: channelId,
                    title: item.snippet.title,
                    description: item.snippet.description,
                    thumbnail_url: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
                    published_at: item.snippet.publishedAt,
                    view_count: parseInt(item.statistics.viewCount || '0'),
                    like_count: parseInt(item.statistics.likeCount || '0'),
                    comment_count: parseInt(item.statistics.commentCount || '0'),
                    duration: item.contentDetails.duration,
                    privacy_status: item.status.privacyStatus,
                    tags: item.snippet.tags || [],
                    last_updated: new Date().toISOString()
                });
            }
        }

        // B. Health Summary (Analytics API)
        // Buscamos o set completo de métricas que a tabela yt_myvideos espera
        const metricsStr = 'views,estimatedMinutesWatched,estimatedRevenue,averageViewDuration,averageViewPercentage,subscribersGained,impressions,ctr,engagedViews,endScreenElementClickThroughRate';
        const url = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=2005-01-01&endDate=${today}&metrics=${metricsStr}&dimensions=video&filters=video==${idsStr}`;

        let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        let hasRevenue = true;

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            // 403 (Forbidden) ou 400 (Bad Request) geralmente indicam falta de permissão para revenue
            if (response.status === 403 || response.status === 400) {
                this.logger.warn(`[Tier1] Analytics error (${response.status}), retrying without revenue...`);
                const fallbackMetrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,impressions,ctr,engagedViews,endScreenElementClickThroughRate';
                const fallbackUrl = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=2005-01-01&endDate=${today}&metrics=${fallbackMetrics}&dimensions=video&filters=video==${idsStr}`;
                response = await fetch(fallbackUrl, { headers: { Authorization: `Bearer ${token}` } });
                hasRevenue = false;
            }
        }

        if (response.ok) {
            const data = await response.json();
            const rows = data.rows || [];
            this.logger.log(`[Tier1] Health summary rows: ${rows.length} (hasRevenue: ${hasRevenue})`);

            for (const row of rows) {
                let vid: string, vws: number, mins: number, rev: number = 0, avgD: number, avgP: number, subs: number, imp: number, ctr: number, engV: number, esc: number;

                if (hasRevenue) {
                    [vid, vws, mins, rev, avgD, avgP, subs, imp, ctr, engV, esc] = row;
                } else {
                    [vid, vws, mins, avgD, avgP, subs, imp, ctr, engV, esc] = row;
                }

                const existing = videoMap.get(vid) || { video_id: vid, channel_id: channelId };
                videoMap.set(vid, {
                    ...existing,
                    analytics_views: vws || 0,
                    estimated_minutes_watched: mins || 0,
                    estimated_revenue: rev || 0,
                    average_view_duration_seconds: avgD || 0,
                    average_view_duration: avgD || 0,
                    average_view_percentage: avgP || 0,
                    subscribers_gained: subs || 0,
                    impressions: imp || 0,
                    click_through_rate: ctr || 0,
                    engaged_views: engV || 0,
                    end_screen_ctr: (esc || 0) * 100,
                    last_updated: new Date().toISOString()
                });
            }
        }

        // Garantir que vídeos sem analytics tenham defaults (evita NOT NULL errors)
        for (const [vid, video] of videoMap.entries()) {
            videoMap.set(vid, {
                analytics_views: 0,
                estimated_minutes_watched: 0,
                estimated_revenue: 0,
                average_view_duration_seconds: 0,
                average_view_duration: 0,
                average_view_percentage: 0,
                subscribers_gained: 0,
                impressions: 0,
                click_through_rate: 0,
                engaged_views: 0,
                end_screen_ctr: 0,
                ...video
            });
        }

        // Final Batch Upsert for yt_myvideos
        const finalRows = Array.from(videoMap.values());
        if (finalRows.length > 0) {
            const { error } = await this.supabase.from('yt_myvideos').upsert(finalRows, { onConflict: 'video_id' });
            if (error) this.logger.error(`[Tier1] Batch Upsert error: ${error.message}`);
        }

        // B. Traffic Types Aggregate (Batch)
        const trafficUrl = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=2005-01-01&endDate=${today}&metrics=views,estimatedMinutesWatched&dimensions=video,insightTrafficSourceType&filters=video==${idsStr}`;
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

            if (dbRows.length > 0) {
                // Trava de Segurança: Só deletamos o histórico se recebemos dados novos para substituir
                const vidsWithData = [...new Set(dbRows.map(r => r.video_id))];
                for (const vid of vidsWithData) {
                    await this.supabase.from('yt_video_traffic_details').delete().eq('video_id', vid).eq('source_detail', '');
                }
                const { error } = await this.supabase.from('yt_video_traffic_details').insert(dbRows);
                if (error) this.logger.error(`[Tier1] Insert error (Traffic): ${error.message}`);
            }
        } else {
            this.logger.error(`[Tier1] API Error (Traffic): ${tRes.status}`);
        }
    }

    private async processBatchTier2(videoIds: string[], token: string, today: string, channelId: string) {
        this.logger.log(`[Tier2] Starting Deep Dive for ${videoIds.length} videos on channel ${channelId}`);
        const startDate = '2022-01-01'; // Etapa 1: Janela reduzida para maior estabilidade

        await Promise.all(videoIds.map(async (vid) => {
            const encodedVid = encodeURIComponent(vid);

            // A. Retention Curve
            const retUrl = `${this.analyticsUrl}?ids=channel==MINE&startDate=${startDate}&endDate=${today}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${vid}`;
            const retRes = await fetch(retUrl, { headers: { Authorization: `Bearer ${token}` } });

            if (retRes.ok) {
                const retData = await retRes.json();
                const rows = retData.rows || [];
                this.logger.log(`[Tier2] Retention curve for ${vid}: ${rows.length} rows`);

                if (rows.length > 0) {
                    // Buscamos a duração do vídeo para converter o ratio em segundos (second_mark)
                    const { data: vData } = await this.supabase.from('yt_myvideos').select('duration').eq('video_id', vid).single();
                    const totalSeconds = vData?.duration ? this.parseDurationSeconds(vData.duration) : 0;

                    const retRows = rows.map(r => ({
                        video_id: vid,
                        second_mark: Math.round(parseFloat(r[0]) * totalSeconds),
                        retention_percentage: parseFloat(r[1]) * 100
                    }));

                    // Trava de Segurança: Só deleta se a API de fato retornou a curva
                    await this.supabase.from('yt_video_retention_curve').delete().eq('video_id', vid);
                    const { error } = await this.supabase.from('yt_video_retention_curve').insert(retRows);
                    if (error) this.logger.error(`[Tier2] DB Error (Retention) for ${vid}: ${error.message}`);
                }
            } else {
                const errBody = await retRes.text();
                this.logger.error(`[Tier2] API Error (Retention) for ${vid}: ${retRes.status} - ${errBody}`);
            }

            // B. Search Keywords Detail
            const detailUrl = `${this.analyticsUrl}?ids=channel==MINE&startDate=${startDate}&endDate=${today}&metrics=views&dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType==YT_SEARCH;video==${vid}`;
            const dRes = await fetch(detailUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (dRes.ok) {
                const dData = await dRes.json();
                const rows = dData.rows || [];
                this.logger.log(`[Tier2] YT_SEARCH details for ${vid}: ${rows.length} rows`);
                const dRows = rows.slice(0, 15).map(r => ({
                    video_id: vid,
                    source_type: 'YT_SEARCH',
                    source_detail: r[0],
                    views: r[1],
                    watch_time_minutes: 0 // Simplificado na Etapa 1
                }));
                if (dRows.length > 0) {
                    await this.supabase.from('yt_video_traffic_details').delete().eq('video_id', vid).eq('source_type', 'YT_SEARCH').neq('source_detail', '');
                    const { error } = await this.supabase.from('yt_video_traffic_details').insert(dRows);
                    if (error) this.logger.error(`[Tier2] DB Error (Search) for ${vid}: ${error.message}`);
                }
            } else {
                const errBody = await dRes.text();
                this.logger.error(`[Tier2] API Error (Search) for ${vid}: ${dRes.status} - ${errBody}`);
            }

            // C. Suggested Videos Detail
            const suggUrl = `${this.analyticsUrl}?ids=channel==MINE&startDate=${startDate}&endDate=${today}&metrics=views&dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType==RELATED_VIDEO;video==${vid}`;
            const sRes = await fetch(suggUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (sRes.ok) {
                const sData = await sRes.json();
                const rows = sData.rows || [];
                this.logger.log(`[Tier2] RELATED_VIDEO details for ${vid}: ${rows.length} rows`);
                const sRows = rows.slice(0, 15).map(r => ({
                    video_id: vid,
                    source_type: 'RELATED_VIDEO',
                    source_detail: r[0],
                    views: r[1],
                    watch_time_minutes: 0 // Simplificado na Etapa 1
                }));
                if (sRows.length > 0) {
                    await this.supabase.from('yt_video_traffic_details').delete().eq('video_id', vid).eq('source_type', 'RELATED_VIDEO').neq('source_detail', '');
                    const { error } = await this.supabase.from('yt_video_traffic_details').insert(sRows);
                    if (error) this.logger.error(`[Tier2] DB Error (Suggested) for ${vid}: ${error.message}`);
                }
            } else {
                const errBody = await sRes.text();
                this.logger.error(`[Tier2] API Error (Suggested) for ${vid}: ${sRes.status} - ${errBody}`);
            }
        }));
    }

    async getDashboardData(channelId: string) {
        this.logger.log(`[Dashboard] Fetching data for channel: ${channelId}`);
        const { data, error } = await this.supabase
            .from('yt_myvideos')
            .select('*')
            .eq('channel_id', channelId)
            .order('view_count', { ascending: false });

        if (error) {
            this.logger.error(`[Dashboard] DB Error: ${error.message}`);
            throw new Error(`Database error: ${error.message}`);
        }

        // Return data in the shape the frontend expects (VideoData[])
        return data.map(v => ({
            id: v.video_id,
            title: v.title,
            thumbnail: v.thumbnail_url,
            description: v.description,
            publishedAt: v.published_at,
            viewCount: v.view_count || v.analytics_views || 0,
            likeCount: v.like_count || 0,
            commentCount: v.comment_count || 0,
            estimatedRevenue: v.estimated_revenue || 0,
            estimatedMinutesWatched: v.estimated_minutes_watched || 0,
            subscribersGained: v.subscribers_gained || 0,
            privacyStatus: v.privacy_status,
            channelId: v.channel_id,
            duration: v.duration
        }));
    }

    async getVideoDetails(videoId: string) {
        this.logger.log(`[VideoDetails] Fetching details for video: ${videoId}`);

        const [retention, traffic] = await Promise.all([
            this.supabase
                .from('yt_video_retention_curve')
                .select('*')
                .eq('video_id', videoId)
                .order('second_mark', { ascending: true }),
            this.supabase
                .from('yt_video_traffic_details')
                .select('*')
                .eq('video_id', videoId)
                .order('views', { ascending: false })
        ]);

        if (retention.error) this.logger.error(`[VideoDetails] Retention Error: ${retention.error.message}`);
        if (traffic.error) this.logger.error(`[VideoDetails] Traffic Error: ${traffic.error.message}`);

        return {
            retention: retention.data || [],
            traffic: traffic.data || []
        };
    }
}
