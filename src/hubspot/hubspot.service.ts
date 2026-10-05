import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';

const API = 'https://api.hubapi.com';
const PAGE_SIZE = 200;
// A Search API devolve no máximo 10.000 resultados por consulta; antes disso avançamos o cursor.
const SEARCH_WINDOW = 9800;
const MIN_REQUEST_GAP_MS = 250; // limite da Search API: ~5 req/s

type StageKind = 'open' | 'meeting_scheduled' | 'meeting_held' | 'won' | 'lost';

/** O significado do estágio vem do rótulo: neste portal os IDs internos não correspondem ao nome. */
const inferStageKind = (label: string): StageKind => {
    const l = label.toLowerCase();
    if (/perdid|lost/.test(l)) return 'lost';
    if (/ganho|fechado|won/.test(l)) return 'won';
    if (/reuni[aã]o realizada/.test(l)) return 'meeting_held';
    if (/reuni[aã]o agendada/.test(l)) return 'meeting_scheduled';
    return 'open';
};

const toIso = (v?: string | null) => (v ? new Date(v).toISOString() : null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class HubspotService {
    private readonly logger = new Logger(HubspotService.name);
    private lastRequestAt = 0;

    constructor(
        private readonly config: ConfigService,
        @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    ) { }

    private tokenCache: { value: string | null; exp: number } | null = null;

    /** Token do Private App: variável de ambiente ou, de preferência, a tabela app_secrets (gravada pela UI). */
    private async token(): Promise<string | null> {
        const fromEnv = this.config.get<string>('HUBSPOT_TOKEN');
        if (fromEnv) return fromEnv;
        if (this.tokenCache && this.tokenCache.exp > Date.now()) return this.tokenCache.value;
        const { data } = await this.supabase.from('app_secrets').select('value').eq('name', 'hubspot_token').maybeSingle();
        this.tokenCache = { value: data?.value || null, exp: Date.now() + 5 * 60_000 };
        return this.tokenCache.value;
    }

    async configured(): Promise<boolean> {
        return !!(await this.token());
    }

    /** Valida o token contra o HubSpot antes de guardar; devolve o erro do HubSpot se não servir. */
    async saveToken(token: string) {
        const clean = token.trim();
        if (!/^pat-/.test(clean)) throw new Error('Isso não parece um token de Private App do HubSpot (começa com "pat-").');
        const res = await fetch(`${API}/crm/v3/owners?limit=1`, { headers: { Authorization: `Bearer ${clean}` } });
        if (!res.ok) throw new Error(`O HubSpot recusou o token (${res.status}). Confira os escopos: crm.objects.deals.read, crm.objects.owners.read, crm.objects.contacts.read.`);
        const { error } = await this.supabase.from('app_secrets').upsert({ name: 'hubspot_token', value: clean });
        if (error) throw new Error(`app_secrets: ${error.message}`);
        this.tokenCache = null;
        return { configured: true };
    }

    async removeToken() {
        const { error } = await this.supabase.from('app_secrets').delete().eq('name', 'hubspot_token');
        if (error) throw new Error(error.message);
        this.tokenCache = null;
        return { configured: !!this.config.get<string>('HUBSPOT_TOKEN') };
    }

    private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
        const token = await this.token();
        if (!token) throw new Error('HubSpot não conectado: cole o token do Private App na tela de Closers.');

        const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastRequestAt = Date.now();

        const res = await fetch(`${API}${path}`, {
            ...init,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
        });

        if (res.status === 429 && attempt < 4) {
            const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
            await sleep(retryAfter * 1000);
            return this.request<T>(path, init, attempt + 1);
        }
        if (!res.ok) throw new Error(`HubSpot ${path} (${res.status}): ${(await res.text()).slice(0, 500)}`);
        return res.json() as Promise<T>;
    }

    private async syncOwners(): Promise<number> {
        const rows: any[] = [];
        for (const archived of [false, true]) {
            let after: string | undefined;
            do {
                const qs = new URLSearchParams({ limit: '100', archived: String(archived), ...(after ? { after } : {}) });
                const page = await this.request<any>(`/crm/v3/owners?${qs}`);
                for (const o of page.results || []) {
                    rows.push({
                        owner_id: Number(o.id),
                        name: [o.firstName, o.lastName].filter(Boolean).join(' ').trim() || o.email || `Owner ${o.id}`,
                        email: o.email || null,
                        active: !archived,
                        updated_at: new Date().toISOString(),
                    });
                }
                after = page.paging?.next?.after;
            } while (after);
        }
        if (rows.length) {
            // `role` fica fora do upsert: é definido pela equipe na UI e não pode ser sobrescrito.
            const { error } = await this.supabase.from('hs_owners').upsert(rows, { onConflict: 'owner_id' });
            if (error) throw new Error(`hs_owners: ${error.message}`);
        }
        return rows.length;
    }

    private async syncStages(): Promise<{ stage_id: string; kind: StageKind }[]> {
        const data = await this.request<any>('/crm/v3/pipelines/deals');
        const { data: existing } = await this.supabase.from('hs_stages').select('stage_id, kind, kind_locked');
        const locked = new Map((existing || []).filter((s: any) => s.kind_locked).map((s: any) => [s.stage_id, s.kind as StageKind]));

        const rows = (data.results || []).flatMap((p: any) =>
            (p.stages || []).map((s: any) => ({
                stage_id: String(s.id),
                pipeline_id: String(p.id),
                pipeline_label: p.label,
                label: s.label,
                display_order: s.displayOrder ?? 0,
                kind: locked.get(String(s.id)) ?? inferStageKind(s.label),
            })),
        );
        if (rows.length) {
            const { error } = await this.supabase.from('hs_stages').upsert(rows, { onConflict: 'stage_id' });
            if (error) throw new Error(`hs_stages: ${error.message}`);
        }
        return rows;
    }

    /**
     * Sync incremental dos negócios, do mais antigo modificado para o mais novo. É resumível:
     * o cursor (hs_lastmodifieddate) é salvo a cada página, então várias execuções curtas
     * (limite da função serverless) cobrem o histórico inteiro.
     */
    async sync(timeBudgetMs = 45000) {
        const startedAt = Date.now();
        const owners = await this.syncOwners();
        const stages = await this.syncStages();

        const meetingProps = (kind: StageKind) =>
            stages.filter((s) => s.kind === kind).map((s) => `hs_v2_date_entered_${s.stage_id}`);
        const scheduledProps = meetingProps('meeting_scheduled');
        const heldProps = meetingProps('meeting_held');

        const properties = [
            'dealname', 'amount', 'pipeline', 'dealstage', 'hubspot_owner_id', 'createdate', 'closedate',
            'utm_content', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'closed_lost_reason',
            'hs_lastmodifieddate', ...scheduledProps, ...heldProps,
        ];

        const { data: state } = await this.supabase.from('hs_sync_state').select('modified_cursor').eq('id', 1).maybeSingle();
        let cursor: string = state?.modified_cursor || '2000-01-01T00:00:00.000Z';

        let deals = 0;
        let caughtUp = false;
        const firstOf = (p: Record<string, string | null>, names: string[]) => names.map((n) => p[n]).find(Boolean) || null;

        while (!caughtUp && Date.now() - startedAt < timeBudgetMs) {
            let after: string | undefined;
            let windowCount = 0;
            let lastModified = cursor;

            do {
                const page = await this.request<any>('/crm/v3/objects/deals/search', {
                    method: 'POST',
                    body: JSON.stringify({
                        filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: new Date(cursor).getTime() }] }],
                        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
                        properties,
                        limit: PAGE_SIZE,
                        ...(after ? { after } : {}),
                    }),
                });

                const results: any[] = page.results || [];
                const rows = results.map((d) => {
                    const p = d.properties || {};
                    return {
                        deal_id: Number(d.id),
                        name: p.dealname || null,
                        pipeline_id: p.pipeline || null,
                        stage_id: p.dealstage || null,
                        owner_id: p.hubspot_owner_id ? Number(p.hubspot_owner_id) : null,
                        amount: p.amount ? Number(p.amount) : null,
                        created_at: toIso(p.createdate),
                        closed_at: toIso(p.closedate),
                        utm_content: p.utm_content || null,
                        utm_source: p.utm_source || null,
                        utm_medium: p.utm_medium || null,
                        utm_campaign: p.utm_campaign || null,
                        utm_term: p.utm_term || null,
                        lost_reason: p.closed_lost_reason || null,
                        meeting_scheduled_at: toIso(firstOf(p, scheduledProps)),
                        meeting_held_at: toIso(firstOf(p, heldProps)),
                        modified_at: toIso(p.hs_lastmodifieddate),
                        synced_at: new Date().toISOString(),
                    };
                });

                if (rows.length) {
                    const { error } = await this.supabase.from('hs_deals').upsert(rows, { onConflict: 'deal_id' });
                    if (error) throw new Error(`hs_deals: ${error.message}`);
                    deals += rows.length;
                    windowCount += rows.length;
                    lastModified = rows[rows.length - 1].modified_at || lastModified;
                }

                after = page.paging?.next?.after;
                if (!after) caughtUp = true;
            } while (after && windowCount < SEARCH_WINDOW && Date.now() - startedAt < timeBudgetMs);

            // Janela inteira com o mesmo timestamp (edição em massa): avança 1 ms para não travar.
            if (!caughtUp && lastModified === cursor) lastModified = new Date(new Date(cursor).getTime() + 1).toISOString();
            cursor = lastModified;

            const { error } = await this.supabase
                .from('hs_sync_state')
                .upsert({ id: 1, modified_cursor: cursor, updated_at: new Date().toISOString() });
            if (error) throw new Error(`hs_sync_state: ${error.message}`);
        }

        const summary = { owners, stages: stages.length, deals, caughtUp, cursor, durationMs: Date.now() - startedAt };
        this.logger.log(`[HubSpot] ${JSON.stringify(summary)}`);
        return summary;
    }
}
