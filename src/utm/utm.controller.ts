import { Controller, Post, Body, Get, Delete, Param } from '@nestjs/common';
import { UtmService } from './utm.service';
import { GenerateSlugDto, ShortenLinkDto, SaveLinkDto } from './utm.dto';

@Controller('utm')
export class UtmController {
    constructor(private readonly utmService: UtmService) { }

    @Post('slug')
    async generateSlug(@Body() body: GenerateSlugDto) {
        // Return object { slug: "..." } to match expectation if needed, or just string.
        // Frontend expects just the string probably or we adjust frontend.
        // Let's return object for better extensibility.
        const slug = await this.utmService.generateSlug(body.title);
        return { slug };
    }

    @Post('shorten')
    async shortenLink(@Body() body: ShortenLinkDto) {
        const shortUrl = await this.utmService.shortenLink(body);
        return { shortUrl };
    }

    @Get('links')
    async getLinks() {
        return this.utmService.getLinks();
    }

    @Post('links')
    async saveLink(@Body() body: SaveLinkDto) {
        return this.utmService.saveLink(body);
    }

    @Delete('links/:id')
    async deleteLink(@Param('id') id: string) {
        return this.utmService.deleteLink(id);
    }
}
