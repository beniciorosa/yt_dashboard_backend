import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class CompetitorsService {
    private readonly logger = new Logger(CompetitorsService.name);
    private supabase: SupabaseClient;

    private readonly YOUTUBE_API_KEY: string;
    private readonly BASE_URL = 'https://www.googleapis.com/youtube/v3';

    constructor(private configService: ConfigService) {
        const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
        const supabaseKey = this.configService.get<string>('SUPABASE_KEY');
        this.YOUTUBE_API_KEY = this.configService.get<string>('YOUTUBE_API_KEY') || '';

        if (!supabaseUrl || !supabaseKey) {
            this.logger.error('Supabase credentials not found in environment variables');
            throw new Error('Supabase credentials missing');
        }

        this.supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        });
    }

    async updateAll(): Promise<string> {
        this.logger.log('Starting update of all competitors...');

        const competitors = await this.fetchCompetitors();
        if (competitors.length === 0) {
            return 'No competitors found to update.';
        }

        let processed = 0;
        const errors: string[] = [];

        // Process in chunks to avoid timeouts but speed up execution
        const CHUNK_SIZE = 5;
        for (let i = 0; i < competitors.length; i += CHUNK_SIZE) {
            const chunk = competitors.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (comp) => {
                try {
                    let lookupInput = comp.channelUrl;

                    if (!comp.id.startsWith('UC')) {
                        if (comp.influencerName && comp.influencerName.length > 2 && !comp.influencerName.includes(' ')) {
                            lookupInput = comp.influencerName;
                        } else {
                            lookupInput = comp.channelName;
                        }
                    }

                    const result = await this.fetchYoutubeChannelData(lookupInput);

                    if (result && result.stats) {
                        await this.addSnapshot(comp.id, result.stats);

                        if (result.avatarUrl && result.avatarUrl !== comp.avatarUrl) {
                            await this.updateCompetitorAvatar(comp.id, result.avatarUrl);
                        }
                    }
                } catch (e: any) {
                    this.logger.error(`Error updating ${comp.channelName}: ${e.message}`);
                    errors.push(`${comp.channelName}: ${e.message}`);
                }
                processed++;
            }));
        }

        const message = `Updated ${processed} competitors. Errors: ${errors.length}`;
        this.logger.log(message);
        return message;
    }

    // --- Helpers ---

    private async fetchCompetitors(): Promise<any[]> {
        const { data: videos, error } = await this.supabase
            .from('yt_videos')
            .select('*')
            .order('last_sync', { ascending: false });

        if (error) {
            this.logger.error('Error fetching competitors from Supabase', error);
            throw error;
        }

        return videos.map(v => {
            const { influencer, customUrl } = this.parseChannelIdField(v.channel_id);
            return {
                id: v.id,
                channelName: v.title || 'Sem Nome',
                influencerName: influencer,
                channelUrl: v.thumbnail_url || '',
                avatarUrl: v.thumbnail_url,
                customUrl: customUrl
            };
        });
    }

    private parseChannelIdField(value: string | null) {
        if (!value) return { influencer: '', customUrl: '' };
        const parts = value.split('|');
        return {
            influencer: parts[0] || '',
            customUrl: parts.length > 5 ? parts[5] : ''
        };
    }

    private extractChannelIdentifier(input: string): { type: 'id' | 'handle' | 'search', value: string } {
        if (!input) return { type: 'search', value: '' };
        let cleaned = input.trim();
        if (cleaned.includes('youtube.com/')) {
            const urlParts = cleaned.split('/');
            const lastPart = urlParts[urlParts.length - 1];
            const secondLastPart = urlParts[urlParts.length - 2];
            if (secondLastPart === 'channel') return { type: 'id', value: lastPart };
            if (cleaned.includes('@')) {
                const handlePart = urlParts.find(p => p.startsWith('@'));
                if (handlePart) return { type: 'handle', value: handlePart };
            }
        }
        if (cleaned.startsWith('UC')) return { type: 'id', value: cleaned };
        if (cleaned.startsWith('@')) return { type: 'handle', value: cleaned };
        return { type: 'handle', value: cleaned };
    }

    private async fetchYoutubeChannelData(input: string): Promise<any | null> {
        const apiKey = this.YOUTUBE_API_KEY;
        const { type, value } = this.extractChannelIdentifier(input);

        let items: any[] = [];

        // 1. Try Direct Lookup
        if (type === 'id' && value.startsWith('UC')) {
            try {
                const url = `${this.BASE_URL}/channels?part=snippet,statistics,contentDetails&id=${value}&key=${apiKey}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.items) items = data.items;
            } catch (e: any) { this.logger.warn(`ID lookup warning: ${e.message}`); }
        } else if (type === 'handle') {
            try {
                const url = `${this.BASE_URL}/channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(value)}&key=${apiKey}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.items) items = data.items;
            } catch (e: any) { this.logger.warn(`Handle lookup warning: ${e.message}`); }
        }

        // 2. Fallback to Search
        if (items.length === 0) {
            try {
                const searchUrl = `${this.BASE_URL}/search?part=id&q=${encodeURIComponent(value)}&type=channel&maxResults=1&key=${apiKey}`;
                const searchRes = await fetch(searchUrl);
                const searchData = await searchRes.json();

                if (searchData.items && searchData.items.length > 0) {
                    const channelId = searchData.items[0].id.channelId;
                    const detailsUrl = `${this.BASE_URL}/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`;
                    const detailsRes = await fetch(detailsUrl);
                    const detailsData = await detailsRes.json();
                    if (detailsData.items) items = detailsData.items;
                }
            } catch (error: any) {
                this.logger.error(`Search fallback failed: ${error.message}`);
            }
        }

        if (!items || items.length === 0) {
            this.logger.warn(`Channel not found for input: ${input}`);
            return null;
        }

        const item = items[0];
        // Força o fuso de Brasília para gerar a data correta
        const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        const avatarUrl = item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url;

        return {
            stats: {
                date: todayLocal,
                subscribers: parseInt(item.statistics.subscriberCount || '0'),
                videos: parseInt(item.statistics.videoCount || '0'),
                views: parseInt(item.statistics.viewCount || '0')
            },
            avatarUrl: avatarUrl
        };
    }

    private async addSnapshot(competitorId: string, stats: any) {
        const dateStr = stats.date;
        // Força o fuso de Brasília para o registro do horário
        const currentTime = new Date().toLocaleTimeString('pt-BR', {
            hour12: false,
            timeZone: 'America/Sao_Paulo'
        });

        const { error } = await this.supabase
            .from('yt_video_metrics_daily')
            .upsert({
                video_id: competitorId,
                date: dateStr,
                views: stats.views,
                likes: stats.subscribers, // Mapping subscribers to likes column as per frontend logic
                comments: stats.videos,   // Mapping videos count to comments column as per frontend logic
                created_at: new Date().toISOString(),
                time_registered: currentTime
            }, { onConflict: 'video_id, date' });

        if (error) {
            this.logger.error('Error adding snapshot', error);
            throw error;
        }
    }

    private async updateCompetitorAvatar(competitorId: string, avatarUrl: string) {
        const { error } = await this.supabase
            .from('yt_videos')
            .update({ thumbnail_url: avatarUrl })
            .eq('id', competitorId);

        if (error) {
            this.logger.error('Error updating avatar', error);
            throw error;
        }
    }
}
