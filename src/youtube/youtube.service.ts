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
                const errorMessage = await response.text();
                this.logger.error(`YouTube API error (${endpoint}): ${errorMessage} - Status: ${response.status}`);
                // Throwing an object that looks like an Axios error for the controller
                throw {
                    response: {
                        status: response.status,
                        data: errorMessage
                    },
                    message: `YouTube API Error: ${response.status}`
                };
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
                throw {
                    response: {
                        status: status,
                        data: jsonBody || rawBody
                    },
                    message: `YouTube API Error: ${status}`
                };
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

        if (error || !data?.refresh_token) {
            throw new Error(`Refresh token ausente para o canal ${channelId}. Faça login novamente no app para reconectar o canal.`);
        }

        const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
        const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');

        // Sem essas credenciais o backend NÃO consegue trocar o refresh_token por um access_token.
        // Elas precisam estar nas variáveis de ambiente do backend (painel da Vercel) — não ficam no .env do repo.
        if (!clientId || !clientSecret) {
            throw new Error('OAuth não configurado no backend: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nas variáveis de ambiente (Vercel). Sem elas, a sincronização do canal sempre falha.');
        }

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: data.refresh_token,
                grant_type: 'refresh_token',
            } as any),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            // Expõe o erro EXATO do Google para diagnóstico:
            //  - invalid_grant  => refresh_token revogado/expirado (relogar; conferir se o app OAuth está em "Production")
            //  - invalid_client => GOOGLE_CLIENT_ID/SECRET incorretos ou de outro app
            const gErr = result?.error || `http_${response.status}`;
            const gDesc = result?.error_description || JSON.stringify(result);
            this.logger.error(`[OAuth] Falha ao renovar token do canal ${channelId}: ${gErr} - ${gDesc}`);
            throw new Error(`Falha ao renovar token do canal ${channelId} (${gErr}): ${gDesc}`);
        }

        if (!result.access_token) {
            throw new Error(`Resposta de token sem access_token para o canal ${channelId}: ${JSON.stringify(result)}`);
        }

        return result.access_token;
    }

    /**
     * Tenta baixar a legenda (transcrição) de um vídeo PRÓPRIO via API do YouTube
     * (escopo youtube.force-ssl, já autorizado). Retorna null se não houver faixa baixável
     * (ex.: legenda automática que a API recusa com 403) — nesse caso o chamador faz fallback.
     */
    async getCaptionTranscript(channelId: string, videoId: string): Promise<{ text: string; lang: string } | null> {
        const token = await this.refreshAccessToken(channelId);

        // 1. Lista as faixas de legenda do vídeo
        let list: any;
        try {
            list = await this.proxyAction(token, 'GET', 'captions', undefined, { part: 'snippet', videoId });
        } catch (e: any) {
            this.logger.warn(`[Captions] list falhou p/ ${videoId}: ${e?.message || e}`);
            return null;
        }

        const items: any[] = list?.items || [];
        if (items.length === 0) return null;

        // 2. Preferência: faixa NÃO-ASR em pt > qualquer pt > não-ASR > a primeira
        const score = (it: any) => {
            const lang = (it.snippet?.language || '').toLowerCase();
            const isAsr = it.snippet?.trackKind === 'asr';
            let s = 0;
            if (lang.startsWith('pt')) s += 2;
            if (!isAsr) s += 1;
            return s;
        };
        items.sort((a, b) => score(b) - score(a));

        // 3. Tenta baixar cada faixa em ordem de preferência (algumas dão 403 — segue p/ próxima)
        for (const track of items) {
            const id = track.id;
            const lang = track.snippet?.language || 'pt';
            try {
                const srt = await this.proxyAction(token, 'GET', `captions/${id}`, undefined, { tfmt: 'srt' });
                const text = typeof srt === 'string' ? srt : '';
                if (text && text.trim().length > 0) {
                    return { text, lang };
                }
            } catch (e: any) {
                this.logger.warn(`[Captions] download faixa ${id} (${lang}) falhou p/ ${videoId}: ${e?.message || e}`);
            }
        }

        return null;
    }

    async syncDetailedEngagement(
        channelId: string,
        specificVideoIds?: string[],
        includeDeepDive = true,
        options?: { maxVideos?: number; timeBudgetMs?: number },
    ) {
        const startTs = Date.now();
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
            if (!channelRes.ok) {
                const body = await channelRes.text();
                throw new Error(`Falha ao buscar o canal ${channelId} (${channelRes.status}): ${body}`);
            }
            const channelData = await channelRes.json();
            const uploadsId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

            if (!uploadsId) throw new Error(`Playlist de uploads não encontrada para o canal ${channelId}`);

            // B. Busca todos os vídeos da playlist (com checagem de erro por página p/ não truncar em silêncio)
            videoIds = [];
            let nextPageToken = '';
            do {
                const url = `${this.baseUrl}/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=50&key=${this.apiKey}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
                const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                if (!res.ok) {
                    const body = await res.text();
                    throw new Error(`Falha ao paginar uploads do canal ${channelId} (${res.status}): ${body}`);
                }
                const data = await res.json();
                if (data.items) {
                    videoIds.push(...data.items.map((i: any) => i.snippet.resourceId.videoId));
                }
                nextPageToken = data.nextPageToken;
            } while (nextPageToken);

            this.logger.log(`[Discovery] Found ${videoIds.length} videos in uploads playlist.`);

            // Resumável: processa primeiro os vídeos mais "velhos" (last_updated mais antigo / nunca sincronizado).
            // Assim, mesmo limitando por execução, o cron converge para o canal inteiro entre as rodadas.
            const { data: existing } = await this.supabase
                .from('yt_myvideos')
                .select('video_id, last_updated')
                .eq('channel_id', channelId);
            const lastMap = new Map<string, number>(
                (existing || []).map((v: any) => [v.video_id, v.last_updated ? new Date(v.last_updated).getTime() : 0]),
            );
            videoIds.sort((a, b) => (lastMap.get(a) ?? 0) - (lastMap.get(b) ?? 0));

            // Se não passou IDs específicos, assume que quer o deep dive como padrão
            if (specificVideoIds === undefined && includeDeepDive === undefined) {
                shouldDeepDive = true;
            }
        }

        // Limites para caber no tempo da função serverless (evita o timeout que congelava o sync).
        const discovered = videoIds.length;
        const maxVideos = options?.maxVideos && options.maxVideos > 0 ? options.maxVideos : videoIds.length;
        const timeBudgetMs = options?.timeBudgetMs ?? 0; // 0 = sem limite de tempo
        const toProcess = videoIds.slice(0, maxVideos);

        this.logger.log(`Processing ${toProcess.length}/${discovered} videos (maxVideos=${maxVideos}, budgetMs=${timeBudgetMs}). Deep Dive: ${shouldDeepDive}`);

        // 1. Tier 1: lotes de 50 — ISOLADOS: um lote que falha NÃO aborta os demais.
        let processed = 0;
        const failedBatches: { index: number; size: number; error: string }[] = [];
        let stoppedByBudget = false;
        for (let i = 0; i < toProcess.length; i += 50) {
            if (timeBudgetMs && Date.now() - startTs > timeBudgetMs) {
                stoppedByBudget = true;
                this.logger.warn(`[Tier1] Orçamento de tempo (${timeBudgetMs}ms) atingido; parando após ${processed} vídeos.`);
                break;
            }
            const batch = toProcess.slice(i, i + 50);
            try {
                await this.processBatchTier1(batch, token, today, channelId);
                processed += batch.length;
            } catch (e: any) {
                this.logger.error(`[Tier1] Lote ${i}-${i + batch.length} falhou: ${e.message}`);
                failedBatches.push({ index: i, size: batch.length, error: e.message });
            }
        }

        // 2. Tier 2: Deep Dive for Top Videos (Traffic Details & Retention) — também isolado.
        if (shouldDeepDive && !stoppedByBudget) {
            try {
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
            } catch (e: any) {
                this.logger.error(`[Tier2] Deep dive falhou: ${e.message}`);
            }
        }

        const summary = {
            success: failedBatches.length === 0,
            channelId,
            discovered,
            processed,
            failedBatches: failedBatches.length,
            stoppedByBudget,
            durationMs: Date.now() - startTs,
        };
        this.logger.log(`[Sync] Resumo: ${JSON.stringify(summary)}`);
        return summary;
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
            this.logger.log(`[Tier1] Data API metadata items found: ${items.length}`);

            for (const item of items) {
                videoMap.set(item.id, {
                    video_id: item.id,
                    channel_id: channelId,
                    title: item.snippet.title || 'Sem Título',
                    description: item.snippet.description || '',
                    thumbnail_url: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
                    published_at: item.snippet.publishedAt,
                    view_count: parseInt(item.statistics?.viewCount || '0'),
                    like_count: parseInt(item.statistics?.likeCount || '0'),
                    comment_count: parseInt(item.statistics?.commentCount || '0'),
                    duration: item.contentDetails?.duration || 'PT0S',
                    privacy_status: item.status?.privacyStatus || 'public',
                    tags: item.snippet.tags || [],
                    last_updated: new Date().toISOString()
                });
            }
        } else {
            const errBody = await dataRes.text();
            this.logger.error(`[Tier1] Data API Error: ${dataRes.status} - ${errBody}`);
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

                if (!vid) continue; // Skip if no video ID in row

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

        // Garantir que vídeos sem analytics ou metadata tenham defaults (evita NOT NULL errors)
        for (const [vid, video] of videoMap.entries()) {
            videoMap.set(vid, {
                title: video.title || 'Sem Título',
                thumbnail_url: video.thumbnail_url || '',
                analytics_views: 0,
                estimated_minutes_watched: 0,
                estimated_revenue: 0,
                average_view_duration_seconds: 0,
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
            try {
                const { error } = await this.supabase.from('yt_myvideos').upsert(finalRows, { onConflict: 'video_id' });
                if (error) {
                    this.logger.error(`[Tier1] Upsert Error: ${error.message}`);
                    if (error.message.includes('estimated_revenue')) {
                        this.logger.warn("Parece que a coluna estimated_revenue ainda não foi criada. Removendo métrica e tentando novamente...");
                        const sanitized = finalRows.map(({ estimated_revenue, ...rest }: any) => rest);
                        const { error: retryErr } = await this.supabase.from('yt_myvideos').upsert(sanitized, { onConflict: 'video_id' });
                        if (retryErr) throw retryErr;
                    } else {
                        throw error;
                    }
                }
            } catch (err: any) {
                this.logger.error(`[Tier1] Final Batch Upsert failed: ${err.message}`);
                // Não lançamos erro aqui para não travar a sincronização de outras partes
                // mas logamos o erro para debug.
            }
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
            try {
                const encodedVid = encodeURIComponent(vid);

                // A. Retention Curve
                const retUrl = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=${startDate}&endDate=${today}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${vid}`;
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
                const detailUrl = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=${startDate}&endDate=${today}&metrics=views&dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType==YT_SEARCH;video==${vid}`;
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
                const suggUrl = `${this.analyticsUrl}?ids=channel==${channelId}&startDate=${startDate}&endDate=${today}&metrics=views&dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType==RELATED_VIDEO;video==${vid}`;
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
            } catch (err: any) {
                this.logger.error(`[Tier2] Unexpected exception for video ${vid}: ${err.message}`);
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
