import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { CompetitorsService } from './competitors/competitors.service';
import { SalesService } from './sales/sales.service';
import { YoutubeService } from './youtube/youtube.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly competitorsService: CompetitorsService,
    private readonly salesService: SalesService,
    private readonly youtubeService: YoutubeService
  ) { }

  @Get('update')
  async update(): Promise<string> {
    return await this.competitorsService.updateAll();
  }

  @Get('sync-my-videos')
  async syncMyVideos(
    @Query('channelId') channelId: string,
    @Query('deepDive') deepDive?: string
  ): Promise<any> {
    // Sincronização de vídeos: Metadados + métricas básicas
    // O deepDive (Tier 2) busca retenção e detalhes de busca para os top vídeos
    const shouldDeepDive = deepDive === 'false' ? false : true;
    return await this.youtubeService.syncDetailedEngagement(channelId, undefined, shouldDeepDive);
  }

  @Get('s_card')
  getSCard(@Query('period') period?: string) {
    return this.salesService.getDashboardData(period);
  }
}
