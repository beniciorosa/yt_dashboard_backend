import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';

export type CloserScope = 'youtube' | 'all';
export const DIMENSIONS = ['tema', 'formato', 'publico', 'produto'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

const num = (v: unknown) => Number(v) || 0;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const parseRange = (start?: string, end?: string) => {
    const s = start || '2000-01-01';
    const e = end || new Date().toISOString().slice(0, 10);
    if (!ISO_DATE.test(s) || !ISO_DATE.test(e) || s > e) throw new BadRequestException('Período inválido (use yyyy-mm-dd)');
    return { start: s, end: e };
};

@Injectable()
export class ClosersService {
    constructor(@Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient) { }

    /**
     * Desempenho por dono de negócio. Leads contam pela criação; ganhos e perdas pelo fechamento.
     * `inferredRole` separa closers de SDRs quando a equipe ainda não classificou o papel:
     * quem tem leads mas nunca fechou venda no período é tratado como SDR.
     */
    async stats(start: string, end: string, scope: CloserScope) {
        const { data, error } = await this.supabase.rpc('closer_stats', { p_start: start, p_end: end, p_scope: scope });
        if (error) throw new Error(`closer_stats: ${error.message}`);

        const rows = (data || []).map((r: any) => {
            const leads = num(r.leads);
            const won = num(r.won);
            const lost = num(r.lost);
            const revenue = num(r.revenue);
            const scheduled = num(r.meetings_scheduled);
            const held = num(r.meetings_held);
            // reuniões só existem para negócios já sincronizados direto do HubSpot
            const hasMeetings = num(r.enriched_deals) > 0;
            return {
                ownerName: r.owner_name as string,
                ownerId: r.owner_id as number | null,
                role: (r.owner_role as string | null) || null,
                inferredRole: r.owner_role || (won > 0 ? 'closer' : leads >= 20 ? 'sdr' : 'outro'),
                leads,
                won,
                lost,
                revenue,
                winRate: ratio(won, won + lost),
                avgTicket: ratio(revenue, won),
                avgCycleDays: r.avg_cycle_days === null ? null : num(r.avg_cycle_days),
                meetingsScheduled: hasMeetings ? scheduled : null,
                meetingsHeld: hasMeetings ? held : null,
                showRate: hasMeetings ? ratio(held, scheduled) : null,
                meetingToWin: hasMeetings ? ratio(won, held) : null,
            };
        }).filter((r) => r.leads + r.won + r.lost > 0);

        rows.sort((a, b) => b.revenue - a.revenue || b.won - a.won);
        const total = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
        const won = total((r) => r.won);
        const lost = total((r) => r.lost);
        const revenue = total((r) => r.revenue);

        return {
            start, end, scope,
            totals: { leads: total((r) => r.leads), won, lost, revenue, winRate: ratio(won, won + lost), avgTicket: ratio(revenue, won) },
            rows,
        };
    }

    /** Dono × tipo de vídeo, com a taxa média de cada tipo para comparar quem fecha acima da média. */
    async matrix(start: string, end: string, dimension: Dimension) {
        const { data, error } = await this.supabase.rpc('closer_type_matrix', { p_start: start, p_end: end, p_dimension: dimension });
        if (error) throw new Error(`closer_type_matrix: ${error.message}`);

        const cells = (data || []).map((r: any) => ({
            ownerName: r.owner_name as string,
            typeId: Number(r.type_id),
            typeName: r.type_name as string,
            closed: num(r.closed),
            won: num(r.won),
            revenue: num(r.revenue),
            winRate: ratio(num(r.won), num(r.closed)),
        }));

        const byType = new Map<number, { typeId: number; typeName: string; closed: number; won: number; revenue: number }>();
        for (const c of cells) {
            const t = byType.get(c.typeId) || { typeId: c.typeId, typeName: c.typeName, closed: 0, won: 0, revenue: 0 };
            t.closed += c.closed;
            t.won += c.won;
            t.revenue += c.revenue;
            byType.set(c.typeId, t);
        }
        const types = [...byType.values()]
            .map((t) => ({ ...t, winRate: ratio(t.won, t.closed) }))
            .sort((a, b) => b.closed - a.closed);

        return { start, end, dimension, types, cells };
    }

    async setOwnerRole(ownerId: number, role: string | null) {
        if (role !== null && !['closer', 'sdr', 'outro'].includes(role)) throw new BadRequestException('Papel inválido');
        const { data, error } = await this.supabase
            .from('hs_owners')
            .update({ role, updated_at: new Date().toISOString() })
            .eq('owner_id', ownerId)
            .select()
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new BadRequestException('Proprietário ainda não sincronizado do HubSpot');
        return data;
    }
}
