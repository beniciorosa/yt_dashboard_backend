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
      load: [() => ({
        SUPABASE_URL: 'https://qytuhvqggsleohxndtqz.supabase.co',
        SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4',
        YOUTUBE_API_KEY: 'AIzaSyBYsoVEnQ9vwQUF4Y0Tf2yCyrx678CKbMo',
        OPENAI_API_KEY: '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',
        ACTIVE_CAMPAIGN_URL: 'https://dhiegorosa.api-us1.com',
        ACTIVE_CAMPAIGN_KEY: '694c5d83a1000c6aa9a5c91584e5bd9cd4fdc8ad149bdc2add57514113cce2774277b9b6b',
        SHORT_IO_API_KEY: 'sk_2KuZLyizAmC7Rrtd',
        UTM_SUPABASE_URL: 'https://qytuhvqggsleohxndtqz.supabase.co',
        UTM_SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dHVodnFnZ3NsZW9oeG5kdHF6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzcwODIxNSwiZXhwIjoyMDc5Mjg0MjE1fQ.5liB1hAHSCezVFRQvlIL7rnPfMrVQKv17dte09bXzb4'
      })],
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
