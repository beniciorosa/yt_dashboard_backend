import { Controller, Get, Param } from '@nestjs/common';
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

  @Get(':videoId')
  getDealsByVideo(@Param('videoId') videoId: string) {
    return this.salesService.getDealsByVideo(videoId);
  }
}
