import { Test, TestingModule } from '@nestjs/testing';
import { ActiveCampaignController } from './active-campaign.controller';

describe('ActiveCampaignController', () => {
  let controller: ActiveCampaignController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActiveCampaignController],
    }).compile();

    controller = module.get<ActiveCampaignController>(ActiveCampaignController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
