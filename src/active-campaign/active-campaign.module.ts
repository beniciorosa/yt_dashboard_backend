import { Module } from '@nestjs/common';
import { ActiveCampaignController } from './active-campaign.controller';
import { ActiveCampaignService } from './active-campaign.service';

@Module({
  controllers: [ActiveCampaignController],
  providers: [ActiveCampaignService]
})
export class ActiveCampaignModule {}
