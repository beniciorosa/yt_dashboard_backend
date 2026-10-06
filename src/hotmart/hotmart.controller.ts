import { Body, Controller, Get, HttpException, HttpStatus, Inject, Post, Query, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { CronAccess } from '../auth/auth.guard';
import { parseRange } from '../attribution/closers.service';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';
import { SyncRunsService } from '../supabase/sync-runs.service';
import { HotmartService } from './hotmart.service';

@Controller('hotmart')
export class HotmartController {
    constructor(
        private readonly hotmart: HotmartService,
        private readonly syncRuns: SyncRunsService,
        @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    ) { }

    private async requireAdmin(req: any) {
        const { data } = await this.supabase.from('user_roles').select('role').eq('id', req.user?.id).maybeSingle();
        if (data?.role !== 'admin') throw new HttpException('Só administradores podem alterar a conexão com a Hotmart.', HttpStatus.FORBIDDEN);
    }

    @CronAccess()
    @Get('sync')
    async sync(@Query('budgetMs') budgetMs?: string) {
        if (!(await this.hotmart.configured())) throw new HttpException('Hotmart não conectada.', HttpStatus.PRECONDITION_FAILED);
        return this.syncRuns.track(
            'hotmart',
            () => this.hotmart.sync(budgetMs ? Number(budgetMs) : undefined),
            (summary) => (summary.backfillDone ? 'success' : 'partial'),
        );
    }

    @Get('status')
    async status() {
        return { configured: await this.hotmart.configured() };
    }

    @Post('credentials')
    async saveCredentials(@Req() req: any, @Body() body: { clientId?: string; clientSecret?: string; basic?: string }) {
        await this.requireAdmin(req);
        try {
            return await this.hotmart.saveCredentials({ clientId: body?.clientId || '', clientSecret: body?.clientSecret || '', basic: body?.basic || '' });
        } catch (e: any) {
            throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
        }
    }

    /** Métricas do período; `product` filtra pelo nome (ex.: metrify). */
    @Get('metrics')
    metrics(@Query('start') start?: string, @Query('end') end?: string, @Query('product') product?: string) {
        const range = parseRange(start, end);
        return this.hotmart.metrics(range.start, range.end, product?.trim() || undefined);
    }
}
