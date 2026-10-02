import { Controller, Get, Post, Body, Query, Param, HttpException, HttpStatus } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import { SyncRunsService } from '../supabase/sync-runs.service';

@Controller('youtube')
export class YoutubeController {
    constructor(
        private readonly youtubeService: YoutubeService,
        private readonly syncRuns: SyncRunsService,
    ) { }

    @Get('proxy')
    async proxy(@Query() query: Record<string, string>) {
        const { endpoint, ...params } = query;
        if (!endpoint) {
            throw new HttpException('Endpoint parameter is required', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.proxy(endpoint, params);
        } catch (error: any) {
            throw new HttpException(error.response?.data || error.message, error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('proxy-action')
    async proxyAction(@Body() body: { token: string; method: string; endpoint: string; data?: any; params?: any }) {
        if (!body.token || !body.endpoint) {
            throw new HttpException('Token and Endpoint are required', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.proxyAction(body.token, body.method || 'POST', body.endpoint, body.data, body.params);
        } catch (error: any) {
            // Forward the Google API error response if possible
            const status = error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
            const message = error.response?.data || error.message;
            throw new HttpException(message, status);
        }
    }

    @Post('oauth/exchange')
    async oauthExchange(@Body() body: { code: string; redirectUri: string }) {
        if (!body.code || !body.redirectUri) {
            throw new HttpException('code e redirectUri são obrigatórios', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.exchangeAuthCode(body.code, body.redirectUri);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.BAD_GATEWAY);
        }
    }

    @Post('oauth/store')
    async oauthStore(@Body() body: { accessToken: string; refreshToken: string }) {
        if (!body.accessToken || !body.refreshToken) {
            throw new HttpException('accessToken e refreshToken são obrigatórios', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.storeProviderRefreshToken(body.accessToken, body.refreshToken);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.BAD_GATEWAY);
        }
    }

    @Post('oauth/token')
    async oauthToken(@Body() body: { channelId?: string }) {
        try {
            return await this.youtubeService.issueAccessToken(body?.channelId);
        } catch (error: any) {
            // 409: o canal precisa ser reconectado (refresh_token ausente/revogado)
            throw new HttpException(error.message, HttpStatus.CONFLICT);
        }
    }

    @Post('sync-detailed')
    async syncDetailed(@Body() body: { channelId: string; videoIds?: string[]; includeDeepDive?: boolean }) {
        if (!body.channelId) {
            throw new HttpException('ChannelId is required', HttpStatus.BAD_REQUEST);
        }
        try {
            // Mesmo orçamento do cron: cabe nos 60 s da função e o cliente repete até cobrir o canal.
            return await this.syncRuns.track(
                'my-videos',
                () => this.youtubeService.syncDetailedEngagement(body.channelId, body.videoIds, body.includeDeepDive, { timeBudgetMs: 45000 }),
                (summary) => (summary.failedBatches > 0 ? 'partial' : 'success'),
            );
        } catch (error: any) {
            console.error('[SyncDetailed] Error:', error.message);
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('dashboard')
    async getDashboard(@Query('channelId') channelId: string) {
        if (!channelId) {
            throw new HttpException('ChannelId is required', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.getDashboardData(channelId);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('video-details/:videoId')
    async getVideoDetails(@Param('videoId') videoId: string) {
        if (!videoId) {
            throw new HttpException('VideoId is required', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.getVideoDetails(videoId);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
