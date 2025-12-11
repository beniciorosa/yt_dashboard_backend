import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ActiveCampaignService {
    private apiUrl: string;
    private apiKey: string;

    constructor(private configService: ConfigService) {
        const url = this.configService.get<string>('ACTIVE_CAMPAIGN_URL') || '';
        this.apiUrl = url.replace(/\/$/, ''); // Remove trailing slash
        this.apiKey = this.configService.get<string>('ACTIVE_CAMPAIGN_KEY') || '';

        if (!this.apiUrl || !this.apiKey) {
            console.warn('ActiveCampaign credentials not found in environment variables');
        }
    }

    private async getValidSenderId(): Promise<number> {
        try {
            const response = await fetch(`${this.apiUrl}/api/3/addresses?limit=1`, {
                headers: { 'Api-Token': this.apiKey }
            });
            const data = await response.json();
            if (data.addresses && data.addresses.length > 0) {
                return parseInt(data.addresses[0].id);
            }
            console.warn('No addresses found in ActiveCampaign, defaulting to senderId 1');
            return 1;
        } catch (error) {
            console.error('Error fetching addresses:', error);
            return 1;
        }
    }

    async getLists() {
        try {
            const response = await fetch(`${this.apiUrl}/api/3/lists?limit=100`, {
                headers: { 'Api-Token': this.apiKey }
            });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Failed to fetch lists (Status ${response.status}): ${errText}`);
            }
            return await response.json();
        } catch (error: any) {
            console.error('Error fetching lists:', error);
            throw new HttpException(error.message || 'Failed to fetch lists', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async sendCampaign(subject: string, body: string, listId: string) {
        try {
            const senderId = await this.getValidSenderId();

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
                            contactId: senderId,
                            allow_unsub: 1,
                            allow_resend: 1
                        }
                    }
                })
            });

            if (!messageRes.ok) {
                const errText = await messageRes.text();
                throw new Error(`Failed to create message (Status ${messageRes.status}): ${errText}`);
            }

            const messageData = await messageRes.json();
            if (!messageData.message) throw new Error("Failed to create message: " + JSON.stringify(messageData));
            const messageId = messageData.message.id;

            // 2. Create Campaign
            const campaignRes = await fetch(`${this.apiUrl}/api/3/campaign`, {
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

            if (!campaignRes.ok) {
                const errText = await campaignRes.text();
                throw new Error(`Failed to create campaign (Status ${campaignRes.status}): ${errText}`);
            }

            const campaignData = await campaignRes.json();
            const campaignId = campaignData.campaign?.id ?? campaignData.id;
            if (!campaignId) throw new Error("Failed to create campaign: " + JSON.stringify(campaignData));

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

        } catch (error: any) {
            console.error("AC Send Error:", error);
            throw new HttpException(error.message || 'Failed to send campaign', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async getReports() {
        try {
            const response = await fetch(`${this.apiUrl}/api/3/campaigns?limit=5&orders[sdate]=DESC`, {
                headers: { 'Api-Token': this.apiKey }
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Failed to fetch reports (Status ${response.status}): ${errText}`);
            }

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
        } catch (error: any) {
            console.error('Error fetching reports:', error);
            throw new HttpException(error.message || 'Failed to fetch reports', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async sendTestEmail(subject: string, body: string, emailTo: string) {
        try {
            const senderId = await this.getValidSenderId();

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
                            contactId: senderId,
                            allow_unsub: 1,
                            allow_resend: 1
                        }
                    }
                })
            });

            if (!messageRes.ok) {
                const errText = await messageRes.text();
                throw new Error(`Failed to create message (Status ${messageRes.status}): ${errText}`);
            }

            const messageData = await messageRes.json();
            if (!messageData.message) throw new Error("Failed to create message for test: " + JSON.stringify(messageData));
            const messageId = messageData.message.id;

            // 2. Create Campaign
            // FIX: Using status 1 (Scheduled) and public 1 to avoid 405 Method Not Allowed on some accounts
            // Also adding logging for debugging
            const campaignUrl = `${this.apiUrl}/api/3/campaign`;
            const campaignBody = {
                campaign: {
                    type: "single",
                    name: `TEST: ${subject} (${new Date().getTime()})`,
                    sdate: new Date(Date.now() + 3600000).toISOString().replace('T', ' ').split('.')[0], // 1 hour in future
                    status: 1, // Scheduled
                    public: 1,
                    tracklinks: "all"
                }
            };

            console.log(`[ActiveCampaign] Creating campaign at ${campaignUrl}`);
            console.log(`[ActiveCampaign] Payload:`, JSON.stringify(campaignBody));

            const campaignRes = await fetch(campaignUrl, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify(campaignBody)
            });

            if (!campaignRes.ok) {
                const errText = await campaignRes.text();
                console.error(`[ActiveCampaign] Failed to create campaign. Status: ${campaignRes.status}. Response: ${errText}`);
                throw new Error(`Failed to create campaign (Status ${campaignRes.status}): ${errText}`);
            }

            const campaignData = await campaignRes.json();
            const campaignId = campaignData.campaign?.id ?? campaignData.id;
            if (!campaignId) throw new Error("Failed to create test campaign: " + JSON.stringify(campaignData));

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
            const testRes = await fetch(`${this.apiUrl}/api/3/campaigns/${campaignId}/send-test-preview`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: emailTo
                })
            });

            if (!testRes.ok) {
                const errText = await testRes.text();
                throw new Error(`Failed to send test preview (Status ${testRes.status}): ${errText}`);
            }

            return { success: true, message: "Test email sent successfully" };

        } catch (error: any) {
            console.error("AC Test Send Error:", error);
            throw new HttpException(error.message || "Unknown error sending test email", HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
