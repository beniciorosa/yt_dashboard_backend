import { Controller, Get, Query } from '@nestjs/common';
import { CompetitorsService } from './competitors/competitors.service';
import { SalesService } from './sales/sales.service';
import { YoutubeService } from './youtube/youtube.service';
import { CronAccess } from './auth/auth.guard';
import { SyncRunsService } from './supabase/sync-runs.service';

@Controller()
export class AppController {
  constructor(
    private readonly competitorsService: CompetitorsService,
    private readonly salesService: SalesService,
    private readonly youtubeService: YoutubeService,
    private readonly syncRuns: SyncRunsService,
  ) { }

  @CronAccess()
  @Get('update')
  async update(): Promise<string> {
    return await this.syncRuns.track('competitors', () => this.competitorsService.updateAll());
  }

  @CronAccess()
  @Get('sync-my-videos')
  async syncMyVideos(
    @Query('channelId') channelId: string,
    @Query('deepDive') deepDive?: string,
    @Query('limit') limit?: string,
    @Query('budgetMs') budgetMs?: string,
  ): Promise<any> {
    // Sincronização de vídeos: Metadados + métricas básicas
    // O deepDive (Tier 2) busca retenção e detalhes de busca para os top vídeos
    const shouldDeepDive = deepDive === 'false' ? false : true;

    // Limites para caber no tempo da função serverless (evita o timeout que congelava o sync).
    // Os vídeos são processados do mais desatualizado para o mais recente, então o cron
    // converge para o canal inteiro mesmo com limite por execução.
    const maxVideos = limit ? Number(limit) : Number(process.env.SYNC_MAX_VIDEOS) || undefined;
    const timeBudgetMs = budgetMs ? Number(budgetMs) : Number(process.env.SYNC_TIME_BUDGET_MS) || 50000;

    return await this.syncRuns.track(
      'my-videos',
      () => this.youtubeService.syncDetailedEngagement(channelId, undefined, shouldDeepDive, { maxVideos, timeBudgetMs }),
      (summary) => (summary.failedBatches > 0 ? 'partial' : 'success'),
    );
  }

  /** Última execução de cada sincronização — alimenta o selo de frescor dos dados na UI. */
  @Get('sync-status')
  syncStatus() {
    return this.syncRuns.latest();
  }

  @Get('s_card')
  getSCard(@Query('period') period?: string) {
    return this.salesService.getDashboardData(period);
  }
}
