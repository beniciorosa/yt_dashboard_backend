import { Controller, Get, Post, Param, Res, Query, Body } from '@nestjs/common';
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

  // Comparação de períodos (aba Análises)
  @Get('analysis')
  getAnalysis(
    @Query('periodA') periodA?: string,
    @Query('startA') startA?: string,
    @Query('endA') endA?: string,
    @Query('periodB') periodB?: string,
    @Query('startB') startB?: string,
    @Query('endB') endB?: string,
    @Query('sellerScope') sellerScope?: string,
  ) {
    return this.salesService.getAnalysis({
      periodA, startA, endA, periodB, startB, endB,
      sellerScope: sellerScope === 'all' ? 'all' : 'youtube',
    });
  }

  @Post('analysis/ai-summary')
  aiSummary(@Body() body: any) {
    return this.salesService.aiSummary(body);
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
