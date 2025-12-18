import { Controller, Get, Param, Res, Query } from '@nestjs/common';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) { }

  @Get('ranking')
  getRanking(@Query('period') period?: string) {
    return this.salesService.getSalesRanking(period);
  }

  @Get('summary')
  getSummary(@Query('period') period?: string) {
    return this.salesService.getSalesSummary(period);
  }

  @Get('dashboard')
  getDashboardData(@Query('period') period?: string) {
    return this.salesService.getDashboardData(period);
  }

  @Get('icons/:uf')
  async getIcon(@Param('uf') uf: string, @Res() res) {
    const svg = await this.salesService.getIconByUF(uf);
    if (!svg) {
      return res.status(404).send('Icon not found');
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  }

  @Get(':videoId')
  getDealsByVideo(@Param('videoId') videoId: string, @Query('period') period?: string) {
    return this.salesService.getDealsByVideo(videoId, period);
  }
}
