import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from './supabase.constants';

export type SyncStatus = 'success' | 'partial' | 'error';

@Injectable()
export class SyncRunsService {
    private readonly logger = new Logger(SyncRunsService.name);

    constructor(@Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient) { }

    /**
     * Executa um job de sincronização registrando início, fim e erro em sync_runs.
     * O erro é relançado: quem chama (cron ou UI) continua vendo a falha.
     */
    async track<T>(job: string, run: () => Promise<T>, statusOf: (result: T) => SyncStatus = () => 'success'): Promise<T> {
        const { data } = await this.supabase.from('sync_runs').insert({ job, status: 'running' }).select('id').single();
        const id = data?.id;
        const finish = async (patch: Record<string, unknown>) => {
            if (!id) return;
            const { error } = await this.supabase
                .from('sync_runs')
                .update({ ...patch, finished_at: new Date().toISOString() })
                .eq('id', id);
            if (error) this.logger.error(`Falha ao registrar sync_runs(${job}): ${error.message}`);
        };

        try {
            const result = await run();
            await finish({ status: statusOf(result), summary: typeof result === 'object' ? result : { result } });
            return result;
        } catch (e: any) {
            await finish({ status: 'error', error: String(e?.message || e).slice(0, 2000) });
            throw e;
        }
    }

    /** Última execução de cada job, para o selo de "frescor dos dados" da UI. */
    async latest() {
        const { data, error } = await this.supabase
            .from('sync_runs')
            .select('job, status, started_at, finished_at, summary, error')
            .order('started_at', { ascending: false })
            .limit(200);
        if (error) throw new Error(error.message);

        const byJob = new Map<string, any>();
        for (const row of data || []) {
            const entry = byJob.get(row.job) || { job: row.job, last: row, lastSuccess: null };
            if (!entry.lastSuccess && row.status !== 'error' && row.status !== 'running') entry.lastSuccess = row.finished_at;
            byJob.set(row.job, entry);
        }
        return Array.from(byJob.values());
    }
}
