import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';
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
}
