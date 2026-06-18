import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CrossViewService } from './cross-view.service';

@Controller('cross-view')
export class CrossViewController {
  constructor(private readonly svc: CrossViewService) {}

  @Get('models')
  getModels() {
    return this.svc.getModels();
  }

  @Post('estimate')
  estimate(@Body() body: { videoIds: string[]; model: string }) {
    return this.svc.estimate(body.videoIds || [], body.model || 'gpt-4o');
  }

  @Get('status')
  status(@Query('videoIds') videoIds: string) {
    const ids = (videoIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.svc.status(ids);
  }

  @Post('extract')
  extract(@Body() body: { videoIds: string[]; force?: boolean }) {
    return this.svc.extract(body.videoIds || [], body.force || false);
  }

  @Post('manual-transcript')
  manualTranscript(@Body() body: { videoId: string; transcript: string }) {
    return this.svc.setManualTranscript(body.videoId, body.transcript);
  }

  @Post('analyze')
  analyze(@Body() body: { videoIds: string[]; model: string; force?: boolean }) {
    return this.svc.analyze(body.videoIds || [], body.model || 'gpt-4o', body.force || false);
  }

  // ----- Histórico -----
  @Get('analyses')
  listAnalyses(@Query('limit') limit?: string) {
    return this.svc.listAnalyses(limit ? parseInt(limit, 10) : 30);
  }

  @Get('analyses/:id')
  getAnalysis(@Param('id') id: string) {
    return this.svc.getAnalysisById(id);
  }

  @Patch('analyses/:id')
  updateAnalysis(@Param('id') id: string, @Body() body: { title?: string; favorite?: boolean }) {
    return this.svc.updateAnalysisMeta(id, body || {});
  }

  @Delete('analyses/:id')
  deleteAnalysis(@Param('id') id: string) {
    return this.svc.deleteAnalysis(id);
  }

  @Post('brief')
  brief(@Body() body: { id: string | number; model?: string; theme?: string }) {
    return this.svc.generateBrief(body.id, body.model, body.theme);
  }
}
