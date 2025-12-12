import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CompetitorsModule } from './competitors/competitors.module';
import { OpenaiModule } from './openai/openai.module';
import { YoutubeModule } from './youtube/youtube.module';
import { ActiveCampaignModule } from './active-campaign/active-campaign.module';
import { UtmModule } from './utm/utm.module';
import { CommentsModule } from './comments/comments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env.production', '.env'],
    }),
    CompetitorsModule,
    OpenaiModule,
    YoutubeModule,
    ActiveCampaignModule,
    UtmModule,
    CommentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
