import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { CompetitorsService } from './competitors/competitors.service';
import { SalesService } from './sales/sales.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly competitorsService: CompetitorsService,
    private readonly salesService: SalesService
  ) { }

  @Get('update')
  async update(): Promise<string> {
    return await this.competitorsService.updateAll();
  }

  @Get('s_card')
  getSCard(@Query('period') period?: string) {
    return this.salesService.getDashboardData(period);
  }
}
