import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ActiveCampaignService {
    private apiUrl: string;
    private apiKey: string;

    constructor(private configService: ConfigService) {
        let url = this.configService.get<string>('ACTIVE_CAMPAIGN_URL') || '';
        // Force HTTPS
        if (url.startsWith('http:')) {
            url = url.replace('http:', 'https:');
        }
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

    async sendCampaign(subject: string, body: string, listId: string, fromname: string, fromemail: string, reply2: string) {
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
                headers: {
                    'Api-Token': this.apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    type: "single",
                    name: subject,
                    fromname: fromname,
                    fromemail: fromemail,
                    reply2: reply2,
                    // Parameters to match verified curl
                    canSplitContent: false,
                    // Removing fields not allowed by singular endpoint
                    // sdate, status, public, tracklinks removed
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
        console.log("teste envio - Iniciando envio de teste para:", emailTo);
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
            const campaignRes = await fetch(campaignUrl, {
                method: 'POST',
                headers: {
                    'Api-Token': this.apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    type: "single",
                    name: `TEST: ${subject} (${new Date().getTime()})`,
                    // Parameters to match verified curl
                    canSplitContent: false
                    // Removing fields not allowed by singular endpoint
                })
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
            const linkRes = await fetch(`${this.apiUrl}/api/3/campaignMessages`, {
                method: 'POST',
                headers: { 'Api-Token': this.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaignMessage: {
                        campaign: campaignId,
                        message: messageId
                    }
                })
            });

            if (!linkRes.ok) {
                const linkErr = await linkRes.text();
                console.error(`[ActiveCampaign] Failed to link message ${messageId} to campaign ${campaignId}. Status: ${linkRes.status}. Resp: ${linkErr}`);
                throw new Error(`Failed to link message to campaign: ${linkErr}`);
            }

            // 4. Skip Sending - End as Draft
            // User requested to save as draft to send via panel
            console.log(`[ActiveCampaign] Test Campaign ${campaignId} created as draft.`);

            return {
                success: true,
                message: "Campanha salva como Rascunho! Acesse o painel do ActiveCampaign para enviar.",
                campaignId
            };

        } catch (error: any) {
            console.error("AC Test Send Error:", error);
            throw new HttpException(error.message || "Unknown error sending test email", HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}

