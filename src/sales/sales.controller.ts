import { Controller, Get, Param, Res } from '@nestjs/common';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) { }

  @Get('ranking')
  getRanking() {
    return this.salesService.getSalesRanking();
  }

  @Get('summary')
  getSummary() {
    return this.salesService.getSalesSummary();
  }

  @Get('dashboard')
  getDashboardData() {
    return this.salesService.getDashboardData();
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
  getDealsByVideo(@Param('videoId') videoId: string) {
    return this.salesService.getDealsByVideo(videoId);
  }
}
