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
  async syncMyVideos(@Query('channelId') channelId: string): Promise<any> {
    // Sincronização completa de vídeos (Metadados + métricas básicas)
    return await this.youtubeService.syncDetailedEngagement(channelId, undefined, false);
  }

  @Get('s_card')
  getSCard(@Query('period') period?: string) {
    return this.salesService.getDashboardData(period);
  }
}
