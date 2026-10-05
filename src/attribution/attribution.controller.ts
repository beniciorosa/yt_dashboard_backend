import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AttributionService } from './attribution.service';
import { CloserScope, ClosersService, Dimension, DIMENSIONS, parseRange } from './closers.service';
import { VideoTypesService } from './video-types.service';

const parseDimension = (value?: string): Dimension => {
    if (!DIMENSIONS.includes(value as Dimension)) throw new BadRequestException(`dimension deve ser uma de: ${DIMENSIONS.join(', ')}`);
    return value as Dimension;
};

@Controller('attribution')
export class AttributionController {
    constructor(private readonly attribution: AttributionService) { }

    @Get('coverage')
    coverage() {
        return this.attribution.coverage();
    }

    @Get('orphans')
    orphans() {
        return this.attribution.orphans();
    }

    @Get('aliases')
    aliases() {
        return this.attribution.listAliases();
    }

    @Post('aliases')
    saveAlias(@Body() body: { utm: string; videoId?: string; bucket?: string; note?: string }) {
        return this.attribution.saveAlias(body);
    }

    @Delete('aliases')
    deleteAlias(@Query('utm') utm: string) {
        if (!utm) throw new BadRequestException('utm é obrigatório');
        return this.attribution.deleteAlias(utm);
    }

    @Get('videos')
    searchVideos(@Query('q') q = '') {
        return this.attribution.searchVideos(q);
    }
}

@Controller('closers')
export class ClosersController {
    constructor(private readonly closers: ClosersService) { }

    @Get()
    stats(@Query('start') start?: string, @Query('end') end?: string, @Query('scope') scope?: string) {
        const range = parseRange(start, end);
        const s: CloserScope = scope === 'all' ? 'all' : 'youtube';
        return this.closers.stats(range.start, range.end, s);
    }

    @Get('matrix')
    matrix(@Query('start') start?: string, @Query('end') end?: string, @Query('dimension') dimension?: string) {
        const range = parseRange(start, end);
        return this.closers.matrix(range.start, range.end, parseDimension(dimension));
    }

    @Get('products')
    products(@Query('start') start?: string, @Query('end') end?: string) {
        const range = parseRange(start, end);
        return this.closers.products(range.start, range.end);
    }

    @Get('recent-wins')
    recentWins(@Query('limit') limit?: string) {
        return this.closers.recentWins(limit ? Number(limit) : 20);
    }

    @Patch('owners/:id')
    setRole(@Param('id', ParseIntPipe) id: number, @Body() body: { role: string | null }) {
        return this.closers.setOwnerRole(id, body.role ?? null);
    }
}

@Controller('video-types')
export class VideoTypesController {
    constructor(private readonly videoTypes: VideoTypesService) { }

    @Get()
    overview() {
        return this.videoTypes.overview();
    }

    @Get('videos')
    videos() {
        return this.videoTypes.videos();
    }

    @Post()
    create(@Body() body: { dimension: string; name: string; description?: string }) {
        return this.videoTypes.createType(parseDimension(body.dimension), body.name, body.description);
    }

    @Patch(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; description?: string }) {
        return this.videoTypes.updateType(id, body);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.videoTypes.deleteType(id);
    }

    @Put('assignments')
    assign(@Body() body: { videoId: string; dimension: string; typeId: number | null }) {
        if (!body.videoId) throw new BadRequestException('videoId é obrigatório');
        return this.videoTypes.assign(body.videoId, parseDimension(body.dimension), body.typeId ?? null);
    }

    /** Classificação por IA, resumível: o cliente repete enquanto `remaining` > 0. */
    @Post('classify')
    classify() {
        return this.videoTypes.classify();
    }
}
