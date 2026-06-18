import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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
  analyze(@Body() body: { videoIds: string[]; model: string }) {
    return this.svc.analyze(body.videoIds || [], body.model || 'gpt-4o');
  }
}
