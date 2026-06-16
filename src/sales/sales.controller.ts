import { Controller, Get, Param, Res, Query } from '@nestjs/common';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) { }

  @Get('ranking')
  getRanking(@Query('period') period?: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.salesService.getSalesRanking(period, start, end);
  }

  @Get('summary')
  getSummary(@Query('period') period?: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.salesService.getSalesSummary(period, start, end);
  }

  @Get('dashboard')
  getDashboardData(@Query('period') period?: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.salesService.getDashboardData(period, start, end);
  }

  // Sempre todo o período (ignora a data selecionada no front)
  @Get('top-videos')
  getTopVideos(@Query('limit') limit?: string) {
    return this.salesService.getTopVideos(limit ? Number(limit) : 5);
  }

  @Get('top-vendedores')
  getTopVendedores(@Query('limit') limit?: string) {
    return this.salesService.getTopVendedores(limit ? Number(limit) : 5);
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
  getDealsByVideo(@Param('videoId') videoId: string, @Query('period') period?: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.salesService.getDealsByVideo(videoId, period, start, end);
  }
}
