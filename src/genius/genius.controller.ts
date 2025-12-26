import { Controller, Get } from '@nestjs/common';
import { GeniusService } from './genius.service';

@Controller('genius')
export class GeniusController {
    constructor(private readonly geniusService: GeniusService) { }

    @Get('video-ideas')
    async getVideoIdeas() {
        return await this.geniusService.generateVideoIdeasFromComments();
    }
}
