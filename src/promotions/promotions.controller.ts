import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { CronAccess } from '../auth/auth.guard';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';
import { SyncRunsService } from '../supabase/sync-runs.service';

/** Uma linha da tabela de Promoções do YouTube Studio, como o coletor a lê. */
interface PromotionRow {
    titulo: string;
    status: string;
    meta: string;
    data_criacao: string;
    custo: string;
    impressoes: string;
    visualizacoes: string;
    inscritos: string;
    cpv: string;
    cps: string;
    thumbnail_url: string;
}

const FIELDS: (keyof PromotionRow)[] = ['titulo', 'status', 'meta', 'data_criacao', 'custo', 'impressoes', 'visualizacoes', 'inscritos', 'cpv', 'cps', 'thumbnail_url'];
const MAX_ROWS = 2000;

/**
 * Recebe a coleta diária das Promoções (não existe API oficial para esses dados: o coletor
 * `tools/promotions-sync` lê a tela do Studio num Chrome logado e envia para cá).
 * Cada envio vira um lote com a mesma `data_coleta`; o painel sempre mostra o lote mais recente.
 */
@Controller('promotions')
export class PromotionsController {
    constructor(
        @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
        private readonly syncRuns: SyncRunsService,
    ) { }

    @CronAccess()
    @Post('import')
    async import(@Body() body: { rows: PromotionRow[]; dryRun?: boolean; source?: string }) {
        const rows = Array.isArray(body?.rows) ? body.rows : null;
        if (!rows) throw new BadRequestException('rows deve ser uma lista');
        if (rows.length > MAX_ROWS) throw new BadRequestException(`Máximo de ${MAX_ROWS} promoções por envio`);

        const clean = rows.map((r, i) => {
            if (!r || typeof r !== 'object') throw new BadRequestException(`Linha ${i} inválida`);
            const out: Record<string, string> = {};
            for (const f of FIELDS) out[f] = String(r[f] ?? '').slice(0, 2000);
            if (!out.thumbnail_url && !out.titulo) throw new BadRequestException(`Linha ${i} sem título nem thumbnail`);
            return out;
        });
        const withVideo = clean.filter((r) => /\/vi(?:_webp)?\/[\w-]{11}/.test(r.thumbnail_url)).length;

        if (body.dryRun) return { dryRun: true, rows: clean.length, withVideo };

        return this.syncRuns.track('promotions', async () => {
            const data_coleta = new Date().toISOString();
            if (clean.length) {
                const { error } = await this.supabase.from('yt_promotions').insert(clean.map((r) => ({ ...r, data_coleta })));
                if (error) throw new Error(`yt_promotions: ${error.message}`);
            }
            return { rows: clean.length, withVideo, data_coleta, source: body.source || 'unknown' };
        });
    }
}
