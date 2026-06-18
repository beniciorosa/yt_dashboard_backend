import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CrossViewController } from './cross-view.controller';
import { CrossViewService } from './cross-view.service';
import { OpenaiModule } from '../openai/openai.module';
import { YoutubeModule } from '../youtube/youtube.module';
import { SalesModule } from '../sales/sales.module';

@Module({
  imports: [ConfigModule, OpenaiModule, YoutubeModule, SalesModule],
  controllers: [CrossViewController],
  providers: [CrossViewService],
})
export class CrossViewModule {}
