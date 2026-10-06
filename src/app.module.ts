import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { CompetitorsModule } from './competitors/competitors.module';
import { SalesModule } from './sales/sales.module';
import { YoutubeModule } from './youtube/youtube.module';
import { AuthModule } from './auth/auth.module';
import { OpenaiModule } from './openai/openai.module';
import { UtmModule } from './utm/utm.module';
import { CommentsModule } from './comments/comments.module';
import { GeniusModule } from './genius/genius.module';
import { CrossViewModule } from './cross-view/cross-view.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AttributionModule } from './attribution/attribution.module';
import { HubspotModule } from './hubspot/hubspot.module';
import { PromotionsModule } from './promotions/promotions.module';
import { HotmartModule } from './hotmart/hotmart.module';
import { AuthGuard } from './auth/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    CompetitorsModule,
    SalesModule,
    YoutubeModule,
    AuthModule,
    OpenaiModule,
    UtmModule,
    CommentsModule,
    GeniusModule,
    CrossViewModule,
    AttributionModule,
    HubspotModule,
    PromotionsModule,
    HotmartModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule { }
