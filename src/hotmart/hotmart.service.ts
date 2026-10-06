import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';

const TOKEN_URL = 'https://api-sec-vlc.hotmart.com/security/oauth/token';
const API = 'https://developers.hotmart.com/payments/api/v1';
const PAGE = 500;
const DAY = 86_400_000;
// Janela do incremental: vendas mudam de status (reembolso, chargeback) semanas depois de aprovadas.
const INCREMENTAL_DAYS = 45;
const BACKFILL_WINDOW_DAYS = 31;
const BACKFILL_FLOOR = new Date('2022-01-01T00:00:00Z').getTime();
// Status que interessam: pagas e as que deixaram de valer.
const STATUSES = ['APPROVED', 'COMPLETE', 'REFUNDED', 'CHARGEBACK', 'PARTIALLY_REFUNDED'];

interface Credentials {
    clientId: string;
    clientSecret: string;
    basic: string;
}

const toIso = (ms?: number | null) => (ms ? new Date(ms).toISOString() : null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class HotmartService {
    private readonly logger = new Logger(HotmartService.name);
    private credsCache: { value: Credentials | null; exp: number } | null = null;
    private tokenCache: { value: string; exp: number } | null = null;

    constructor(
        private readonly config: ConfigService,
        @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    ) { }

    /** Credenciais do app (Hotmart → Ferramentas → Credenciais de desenvolvedor): env ou app_secrets. */
    private async credentials(): Promise<Credentials | null> {
        const env = ['HOTMART_CLIENT_ID', 'HOTMART_CLIENT_SECRET', 'HOTMART_BASIC'].map((k) => this.config.get<string>(k));
        if (env.every(Boolean)) return { clientId: env[0]!, clientSecret: env[1]!, basic: env[2]! };
        if (this.credsCache && this.credsCache.exp > Date.now()) return this.credsCache.value;

        const { data } = await this.supabase
            .from('app_secrets')
            .select('name, value')
            .in('name', ['hotmart_client_id', 'hotmart_client_secret', 'hotmart_basic']);
        const map = new Map((data || []).map((r) => [r.name, r.value]));
        const id = map.get('hotmart_client_id');
        const secret = map.get('hotmart_client_secret');
        const basic = map.get('hotmart_basic');
        const value = id && secret && basic ? { clientId: id, clientSecret: secret, basic } : null;
        this.credsCache = { value, exp: Date.now() + 5 * 60_000 };
        return value;
    }

    async configured(): Promise<boolean> {
        return !!(await this.credentials());
    }

    private async fetchToken(creds: Credentials): Promise<string> {
        const qs = new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret });
        const res = await fetch(`${TOKEN_URL}?${qs.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Basic ${creds.basic}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.access_token) {
            throw new Error(`Hotmart recusou as credenciais (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
        }
        // renova 10 min antes de expirar
        this.tokenCache = { value: body.access_token, exp: Date.now() + Math.max(60, Number(body.expires_in) - 600) * 1000 };
        return body.access_token;
    }

    private async token(): Promise<string> {
        if (this.tokenCache && this.tokenCache.exp > Date.now()) return this.tokenCache.value;
        const creds = await this.credentials();
        if (!creds) throw new Error('Hotmart não conectada: cole as credenciais em Admin → Integrações.');
        return this.fetchToken(creds);
    }

    /** Valida as credenciais pedindo um token e, se der certo, guarda em app_secrets. */
    async saveCredentials(input: { clientId: string; clientSecret: string; basic: string }) {
        const clientId = input.clientId.trim();
        const clientSecret = input.clientSecret.trim();
        if (!clientId || !clientSecret) throw new Error('Informe o Client ID e o Client Secret.');
        // O "Basic" da Hotmart é só base64("client_id:client_secret"); se não vier, calculamos.
        const basic = input.basic.trim().replace(/^Basic\s+/i, '') || Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const creds = { clientId, clientSecret, basic };
        await this.fetchToken(creds);
        const { error } = await this.supabase.from('app_secrets').upsert([
            { name: 'hotmart_client_id', value: creds.clientId },
            { name: 'hotmart_client_secret', value: creds.clientSecret },
            { name: 'hotmart_basic', value: creds.basic },
        ]);
        if (error) throw new Error(`app_secrets: ${error.message}`);
        this.credsCache = null;
        return { configured: true };
    }

    private async request<T>(path: string, params: Record<string, string>, attempt = 0): Promise<T> {
        const token = await this.token();
        const res = await fetch(`${API}${path}?${new URLSearchParams(params).toString()}`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (res.status === 429 && attempt < 4) {
            await sleep(2 ** attempt * 1500);
            return this.request<T>(path, params, attempt + 1);
        }
        if (res.status === 401 && attempt === 0) {
            this.tokenCache = null;
            return this.request<T>(path, params, attempt + 1);
        }
        if (!res.ok) throw new Error(`Hotmart ${path} (${res.status}): ${(await res.text()).slice(0, 300)}`);
        return res.json() as Promise<T>;
    }

    private async allPages(path: string, params: Record<string, string>): Promise<any[]> {
        const items: any[] = [];
        let pageToken: string | undefined;
        do {
            const page = await this.request<any>(path, {
                ...params,
                max_results: String(PAGE),
                ...(pageToken ? { page_token: pageToken } : {}),
            });
            items.push(...(page.items || []));
            pageToken = page.page_info?.next_page_token;
        } while (pageToken);
        return items;
    }

    /** Baixa vendas + comissões de uma janela e grava em hotmart_sales. Devolve quantas linhas. */
    private async syncWindow(startMs: number, endMs: number): Promise<number> {
        const base = { start_date: String(startMs), end_date: String(endMs) };
        const rows = new Map<string, Record<string, unknown>>();

        for (const status of STATUSES) {
            const items = await this.allPages('/sales/history', { ...base, transaction_status: status });
            for (const it of items) {
                const p = it.purchase || {};
                if (!p.transaction) continue;
                rows.set(p.transaction, {
                    transaction: p.transaction,
                    product_id: it.product?.id ?? null,
                    product_name: it.product?.name ?? null,
                    offer_code: p.offer?.code ?? null,
                    buyer_name: it.buyer?.name ?? null,
                    buyer_email: it.buyer?.email ?? null,
                    status: p.status || status,
                    order_date: toIso(p.order_date),
                    approved_date: toIso(p.approved_date),
                    price: p.price?.value ?? null,
                    currency: p.price?.currency_code ?? null,
                    hotmart_fee: p.hotmart_fee?.total ?? null,
                    payment_type: p.payment?.type ?? null,
                    installments: p.payment?.installments_number ?? null,
                    is_subscription: p.is_subscription ?? null,
                    recurrency_number: p.recurrency_number ?? null,
                    source_sck: p.tracking?.source_sck ?? null,
                    updated_at: new Date().toISOString(),
                });
            }
        }
        if (rows.size === 0) return 0;

        // valor que sobra para o produtor depois das taxas e dos splits
        for (const status of STATUSES) {
            const items = await this.allPages('/sales/commissions', { ...base, transaction_status: status });
            for (const it of items) {
                const row = rows.get(it.transaction);
                if (!row) continue;
                const producer = (it.commissions || []).find((c: any) => c.source === 'PRODUCER');
                if (producer?.commission?.value !== undefined) row.producer_net = producer.commission.value;
            }
        }

        const list = [...rows.values()];
        for (let i = 0; i < list.length; i += 500) {
            const { error } = await this.supabase.from('hotmart_sales').upsert(list.slice(i, i + 500), { onConflict: 'transaction' });
            if (error) throw new Error(`hotmart_sales: ${error.message}`);
        }
        return list.length;
    }

    /**
     * Incremental (últimos 45 dias, sempre) + backfill para trás em janelas de 31 dias até
     * encontrar 3 meses seguidos sem vendas (ou 2022). Resumível entre execuções.
     */
    async sync(timeBudgetMs = 45000) {
        const startedAt = Date.now();
        const now = Date.now();
        const recent = await this.syncWindow(now - INCREMENTAL_DAYS * DAY, now);

        const { data: state } = await this.supabase.from('hotmart_sync_state').select('*').eq('id', 1).maybeSingle();
        let until = state?.backfill_until ? new Date(state.backfill_until).getTime() : now - INCREMENTAL_DAYS * DAY;
        let done = !!state?.backfill_done;
        let backfilled = 0;
        let emptyStreak = 0;

        while (!done && Date.now() - startedAt < timeBudgetMs) {
            const end = until;
            const start = Math.max(BACKFILL_FLOOR, end - BACKFILL_WINDOW_DAYS * DAY);
            const n = await this.syncWindow(start, end);
            backfilled += n;
            emptyStreak = n === 0 ? emptyStreak + 1 : 0;
            until = start;
            if (start <= BACKFILL_FLOOR || emptyStreak >= 3) done = true;
            const { error } = await this.supabase.from('hotmart_sync_state').upsert({
                id: 1,
                backfill_until: new Date(until).toISOString(),
                backfill_done: done,
                updated_at: new Date().toISOString(),
            });
            if (error) throw new Error(`hotmart_sync_state: ${error.message}`);
        }

        const summary = { recent, backfilled, backfillDone: done, backfillUntil: new Date(until).toISOString(), durationMs: Date.now() - startedAt };
        this.logger.log(`[Hotmart] ${JSON.stringify(summary)}`);
        return summary;
    }

    async metrics(start: string, end: string, product?: string) {
        const { data, error } = await this.supabase.rpc('hotmart_metrics', { p_start: start, p_end: end, p_product: product || null });
        if (error) throw new Error(`hotmart_metrics: ${error.message}`);
        return data;
    }
}
