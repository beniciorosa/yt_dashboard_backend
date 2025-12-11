import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OpenaiService } from './openai.service';

@Controller('openai')
export class OpenaiController {
    constructor(private readonly openaiService: OpenaiService) { }

    @Post('generate-email')
    async generateEmail(@Body() body: { title: string; description: string; url: string }) {
        return this.openaiService.generateEmail(body.title, body.description, body.url);
    }

    @Post('generate-description')
    async generateDescription(@Body() body: { transcription: string; title: string }) {
        return this.openaiService.generateDescription(body.transcription, body.title);
    }

    @Post('transcribe')
    async transcribeAudio(@Body() body: { fileUrl: string }) {
        return this.openaiService.transcribeAudio(body.fileUrl);
    }
}
