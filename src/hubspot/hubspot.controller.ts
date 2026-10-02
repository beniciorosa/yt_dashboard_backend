import { Controller, Get, HttpException, HttpStatus, Query } from '@nestjs/common';
import { CronAccess } from '../auth/auth.guard';
import { SyncRunsService } from '../supabase/sync-runs.service';
import { HubspotService } from './hubspot.service';

@Controller('hubspot')
export class HubspotController {
    constructor(
        private readonly hubspot: HubspotService,
        private readonly syncRuns: SyncRunsService,
    ) { }

    /** Chamado pelo pg_cron (x-cron-secret) e pelo botão "Sincronizar" da tela de Closers. */
    @CronAccess()
    @Get('sync')
    async sync(@Query('budgetMs') budgetMs?: string) {
        if (!this.hubspot.configured) {
            throw new HttpException('HUBSPOT_TOKEN não configurado no backend.', HttpStatus.PRECONDITION_FAILED);
        }
        return this.syncRuns.track(
            'hubspot',
            () => this.hubspot.sync(budgetMs ? Number(budgetMs) : undefined),
            (summary) => (summary.caughtUp ? 'success' : 'partial'),
        );
    }

    @Get('status')
    status() {
        return { configured: this.hubspot.configured };
    }
}
