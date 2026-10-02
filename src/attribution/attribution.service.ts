import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';

export type AttributionMethod = 'link' | 'slug' | 'alias' | 'bucket' | 'unattributed';

const num = (v: unknown) => Number(v) || 0;
const normalizeUtm = (utm: string) => utm.trim().toLowerCase();

@Injectable()
export class AttributionService {
    constructor(@Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient) { }

    private async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T[]> {
        const { data, error } = await this.supabase.rpc(fn, args);
        if (error) throw new Error(`${fn}: ${error.message}`);
        return (data || []) as T[];
    }

    /** Quanto dos negócios vindos do YouTube está ligado a um vídeo, e por qual método. */
    async coverage() {
        const rows = await this.rpc<{ method: AttributionMethod; deals: number; won: number; revenue: number }>('attribution_coverage');
        const methods = rows.map((r) => ({ method: r.method, deals: num(r.deals), won: num(r.won), revenue: num(r.revenue) }));
        const sum = (pick: (m: (typeof methods)[number]) => number, filter: (m: (typeof methods)[number]) => boolean = () => true) =>
            methods.filter(filter).reduce((acc, m) => acc + pick(m), 0);
        const attributed = (m: (typeof methods)[number]) => m.method !== 'unattributed';

        const totalDeals = sum((m) => m.deals);
        const totalRevenue = sum((m) => m.revenue);
        return {
            methods,
            totalDeals,
            attributedDeals: sum((m) => m.deals, attributed),
            totalRevenue,
            attributedRevenue: sum((m) => m.revenue, attributed),
            dealCoverage: totalDeals ? sum((m) => m.deals, attributed) / totalDeals : null,
            revenueCoverage: totalRevenue ? sum((m) => m.revenue, attributed) / totalRevenue : null,
        };
    }

    /** UTMs de YouTube sem vídeo, da maior receita para a menor, com vídeos candidatos pela data do slug. */
    async orphans() {
        const rows = await this.rpc<any>('attribution_orphans');
        return rows.map((r) => ({
            utm: r.utm as string,
            deals: num(r.deals),
            won: num(r.won),
            revenue: num(r.revenue),
            firstDeal: r.first_deal as string | null,
            lastDeal: r.last_deal as string | null,
            candidates: (r.candidates || []) as { video_id: string; title: string; thumbnail_url: string; published_at: string }[],
        }));
    }

    async listAliases() {
        const { data, error } = await this.supabase.from('utm_aliases').select('*').order('created_at', { ascending: false });
        if (error) throw new Error(error.message);

        const videoIds = [...new Set((data || []).map((a) => a.video_id).filter(Boolean))];
        const titles = new Map<string, string>();
        if (videoIds.length) {
            const { data: videos } = await this.supabase.from('yt_myvideos').select('video_id, title').in('video_id', videoIds);
            (videos || []).forEach((v) => titles.set(v.video_id, v.title));
        }
        return (data || []).map((a) => ({ ...a, video_title: a.video_id ? titles.get(a.video_id) || null : null }));
    }

    async saveAlias(input: { utm: string; videoId?: string; bucket?: string; note?: string }) {
        const utm = normalizeUtm(input.utm || '');
        const videoId = input.videoId?.trim() || null;
        const bucket = input.bucket?.trim() || null;
        if (!utm) throw new BadRequestException('utm é obrigatório');
        if (!videoId === !bucket) throw new BadRequestException('Informe um vídeo ou um destino genérico (apenas um dos dois)');

        if (videoId) {
            const { data } = await this.supabase.from('yt_myvideos').select('video_id').eq('video_id', videoId).maybeSingle();
            if (!data) throw new BadRequestException(`Vídeo ${videoId} não está na base do canal`);
        }

        const { data, error } = await this.supabase
            .from('utm_aliases')
            .upsert({ utm_content: utm, video_id: videoId, bucket, note: input.note?.trim() || null })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    }

    async deleteAlias(utm: string) {
        const { error } = await this.supabase.from('utm_aliases').delete().eq('utm_content', normalizeUtm(utm));
        if (error) throw new Error(error.message);
        return { success: true };
    }

    /** Busca de vídeos do canal por título ou ID, para o seletor de vínculo manual. */
    async searchVideos(query: string) {
        const q = query.trim().replace(/[%,()]/g, ' ');
        if (q.length < 2) return [];
        const { data, error } = await this.supabase
            .from('yt_myvideos')
            .select('video_id, title, thumbnail_url, published_at')
            .or(`title.ilike.%${q}%,video_id.eq.${q.replace(/\s/g, '')}`)
            .order('published_at', { ascending: false })
            .limit(20);
        if (error) throw new Error(error.message);
        return data || [];
    }
}
