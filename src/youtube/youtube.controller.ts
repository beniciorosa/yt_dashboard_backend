import { Controller, Get, Post, Body, Query, Param, HttpException, HttpStatus } from '@nestjs/common';
import { YoutubeService } from './youtube.service';

@Controller('youtube')
export class YoutubeController {
    constructor(private readonly youtubeService: YoutubeService) { }

    @Get('proxy')
    async proxy(@Query() query: Record<string, string>) {
        const { endpoint, ...params } = query;
        if (!endpoint) {
            throw new HttpException('Endpoint parameter is required', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.proxy(endpoint, params);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
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

    @Post('save-auth')
    async saveAuth(@Body() body: { channelId: string; refreshToken: string }) {
        if (!body.channelId || !body.refreshToken) {
            throw new HttpException('ChannelId and RefreshToken are required', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.saveRefreshToken(body.channelId, body.refreshToken);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('sync-detailed')
    async syncDetailed(@Body() body: { channelId: string; videoIds?: string[]; includeDeepDive?: boolean }) {
        if (!body.channelId) {
            throw new HttpException('ChannelId is required', HttpStatus.BAD_REQUEST);
        }
        try {
            return await this.youtubeService.syncDetailedEngagement(body.channelId, body.videoIds, body.includeDeepDive);
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
