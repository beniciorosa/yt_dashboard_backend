import { Controller, Get, Post, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
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
            throw new HttpException(error.response?.data || error.message, error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
