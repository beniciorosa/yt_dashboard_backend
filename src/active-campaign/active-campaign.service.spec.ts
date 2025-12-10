import { Test, TestingModule } from '@nestjs/testing';
import { ActiveCampaignService } from './active-campaign.service';

describe('ActiveCampaignService', () => {
  let service: ActiveCampaignService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ActiveCampaignService],
    }).compile();

    service = module.get<ActiveCampaignService>(ActiveCampaignService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
