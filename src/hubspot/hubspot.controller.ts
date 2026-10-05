import { Body, Controller, Delete, Get, HttpException, HttpStatus, Inject, Post, Query, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';
import { CronAccess } from '../auth/auth.guard';
import { SyncRunsService } from '../supabase/sync-runs.service';
import { HubspotService } from './hubspot.service';

@Controller('hubspot')
export class HubspotController {
    constructor(
        private readonly hubspot: HubspotService,
        private readonly syncRuns: SyncRunsService,
        @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    ) { }

    /** Só admins mexem na conexão (o AuthGuard já garantiu o login; aqui checa o papel). */
    private async requireAdmin(req: any) {
        const { data } = await this.supabase.from('user_roles').select('role').eq('id', req.user?.id).maybeSingle();
        if (data?.role !== 'admin') throw new HttpException('Só administradores podem alterar a conexão com o HubSpot.', HttpStatus.FORBIDDEN);
    }

    /** Chamado pelo pg_cron (x-cron-secret) e pelo botão "Sincronizar" da tela de Closers. */
    @CronAccess()
    @Get('sync')
    async sync(@Query('budgetMs') budgetMs?: string) {
        if (!(await this.hubspot.configured())) {
            throw new HttpException('HUBSPOT_TOKEN não configurado no backend.', HttpStatus.PRECONDITION_FAILED);
        }
        return this.syncRuns.track(
            'hubspot',
            () => this.hubspot.sync(budgetMs ? Number(budgetMs) : undefined),
            (summary) => (summary.caughtUp ? 'success' : 'partial'),
        );
    }

    /** Preenche produtos (itens de linha) dos negócios já sincronizados; repetir até remaining = 0. */
    @CronAccess()
    @Get('backfill-products')
    async backfillProducts(@Query('budgetMs') budgetMs?: string) {
        return this.syncRuns.track(
            'hubspot-products',
            () => this.hubspot.backfillProducts(budgetMs ? Number(budgetMs) : undefined),
            (summary) => (summary.remaining > 0 ? 'partial' : 'success'),
        );
    }

    @Get('status')
    async status() {
        return { configured: await this.hubspot.configured() };
    }

    @Post('token')
    async saveToken(@Req() req: any, @Body() body: { token?: string }) {
        await this.requireAdmin(req);
        if (!body?.token) throw new HttpException('token é obrigatório', HttpStatus.BAD_REQUEST);
        try {
            return await this.hubspot.saveToken(body.token);
        } catch (e: any) {
            throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
        }
    }

    @Delete('token')
    async removeToken(@Req() req: any) {
        await this.requireAdmin(req);
        return this.hubspot.removeToken();
    }
}
