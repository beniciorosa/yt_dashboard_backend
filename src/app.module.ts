import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CompetitorsModule } from './competitors/competitors.module';

@Module({
  imports: [CompetitorsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
