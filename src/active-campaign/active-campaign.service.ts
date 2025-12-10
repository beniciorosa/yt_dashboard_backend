import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ActiveCampaignService {
    private apiUrl: string;
    private apiKey: string;

    constructor(private configService: ConfigService) {
        this.apiUrl = this.configService.get<string>('ACTIVE_CAMPAIGN_URL') || '';
        this.apiKey = this.configService.get<string>('ACTIVE_CAMPAIGN_KEY') || '';

        if (!this.apiUrl || !this.apiKey) {
            console.warn('ActiveCampaign credentials not found in environment variables');
        }
    }

    async getLists() {
        try {
            const response = await fetch(`${this.apiUrl}/api/3/lists?limit=100`, {
                headers: { 'Api-Token': this.apiKey }
            });
            return await response.json();
        } catch (error) {
            console.error('Error fetching lists:', error);
            throw new Error('Failed to fetch lists');
        }
    }

    async sendCampaign(subject: string, body: string, listId: string) {
        try {
            // 1. Create Message
            const messageRes = await fetch(`${this.apiUrl}/api/3/messages`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: {
                        subject: subject,
                        html: body,
                        text: body.replace(/<[^>]*>?/gm, ''),
                        p: { [listId]: listId },
                        sender: {
                            contactId: 1 // Default sender
                        }
                    }
                })
            });
            const messageData = await messageRes.json();
            if (!messageData.message) throw new Error("Failed to create message: " + JSON.stringify(messageData));
            const messageId = messageData.message.id;

            // 2. Create Campaign
            const campaignRes = await fetch(`${this.apiUrl}/api/3/campaigns`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaign: {
                        type: "single",
                        name: subject,
                        sdate: new Date().toISOString().replace('T', ' ').split('.')[0],
                        status: 1, // Scheduled
                        public: 1,
                        tracklinks: "all"
                    }
                })
            });
            const campaignData = await campaignRes.json();
            if (!campaignData.campaign) throw new Error("Failed to create campaign: " + JSON.stringify(campaignData));
            const campaignId = campaignData.campaign.id;

            // 3. Link Message to Campaign
            await fetch(`${this.apiUrl}/api/3/campaignMessages`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaignMessage: {
                        campaign: campaignId,
                        message: messageId
                    }
                })
            });

            // 4. Link List to Campaign
            await fetch(`${this.apiUrl}/api/3/campaignLists`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaignList: {
                        campaign: campaignId,
                        listid: listId
                    }
                })
            });

            return { success: true, campaignId };

        } catch (error) {
            console.error("AC Send Error:", error);
            throw error;
        }
    }

    async getReports() {
        try {
            const response = await fetch(`${this.apiUrl}/api/3/campaigns?limit=5&orders[sdate]=DESC`, {
                headers: { 'Api-Token': this.apiKey }
            });
            const data = await response.json();

            if (!data.campaigns) return [];

            return data.campaigns.map((c: any) => ({
                id: c.id,
                name: c.name,
                status: c.status,
                sdate: c.sdate,
                opens: c.opens,
                uniqueopens: c.uniqueopens,
                linkclicks: c.linkclicks,
                subscriberclicks: c.subscriberclicks,
                forwards: c.forwards,
                hardbounces: c.hardbounces,
                softbounces: c.softbounces,
                unsubscribes: c.unsubscribes
            }));
        } catch (error) {
            console.error('Error fetching reports:', error);
            throw new Error('Failed to fetch reports');
        }
    }

    async sendTestEmail(subject: string, body: string, emailTo: string) {
        try {
            // 1. Create Message (Draft)
            const messageRes = await fetch(`${this.apiUrl}/api/3/messages`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: {
                        subject: subject,
                        html: body,
                        text: body.replace(/<[^>]*>?/gm, ''),
                        sender: {
                            contactId: 1
                        }
                    }
                })
            });
            const messageData = await messageRes.json();
            if (!messageData.message) throw new Error("Failed to create message for test: " + JSON.stringify(messageData));
            const messageId = messageData.message.id;

            // 2. Create Campaign (Draft - status 0)
            const campaignRes = await fetch(`${this.apiUrl}/api/3/campaigns`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaign: {
                        type: "single",
                        name: `TEST: ${subject}`,
                        sdate: new Date().toISOString().replace('T', ' ').split('.')[0],
                        status: 0, // Hidden/Draft
                        public: 0,
                        tracklinks: "all"
                    }
                })
            });
            const campaignData = await campaignRes.json();
            if (!campaignData.campaign) throw new Error("Failed to create test campaign: " + JSON.stringify(campaignData));
            const campaignId = campaignData.campaign.id;

            // 3. Link Message
            await fetch(`${this.apiUrl}/api/3/campaignMessages`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaignMessage: {
                        campaign: campaignId,
                        message: messageId
                    }
                })
            });

            // 4. Send Test Preview
            // Endpoint: POST /campaigns/{id}/send-test-preview
            // Body: { "email": "test@example.com" }
            const testRes = await fetch(`${this.apiUrl}/api/3/campaigns/${campaignId}/send-test-preview`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: emailTo
                })
            });

            if (!testRes.ok) {
                const err = await testRes.json();
                throw new Error("Failed to send test preview: " + JSON.stringify(err));
            }

            return { success: true, message: "Test email sent successfully" };

        } catch (error) {
            console.error("AC Test Send Error:", error);
            throw error;
        }
    }
}
