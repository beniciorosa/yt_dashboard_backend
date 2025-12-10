import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { CompetitorsService } from './competitors/competitors.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly competitorsService: CompetitorsService
  ) { }

  @Get('update')
  async update(): Promise<string> {
    return await this.competitorsService.updateAll();
  }
}
