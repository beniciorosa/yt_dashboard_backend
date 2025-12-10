import { Body, Controller, Get, Post } from '@nestjs/common';
import { ActiveCampaignService } from './active-campaign.service';

@Controller('api/active-campaign')
export class ActiveCampaignController {
    constructor(private readonly activeCampaignService: ActiveCampaignService) { }

    @Get('lists')
    async getLists() {
        return this.activeCampaignService.getLists();
    }

    @Get('reports')
    async getReports() {
        return this.activeCampaignService.getReports();
    }

    @Post('send')
    async sendCampaign(@Body() body: { subject: string; body: string; listId: string }) {
        return this.activeCampaignService.sendCampaign(body.subject, body.body, body.listId);
    }

    @Post('send-test')
    async sendTestEmail(@Body() body: { subject: string; body: string; emailTo: string }) {
        return this.activeCampaignService.sendTestEmail(body.subject, body.body, body.emailTo);
    }
}
