
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CommentsService } from '../src/comments/comments.service';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const commentsService = app.get(CommentsService);

    const comment = "Muito legal o vídeo sobre Mercado Livre!";
    const videoTitle = "Como crescer no e-commerce";

    console.log("--- Testing OpenAI (GPT-5.2 Pro) ---");
    try {
        const openaiReply = await commentsService.generateAiReply(comment, videoTitle, 'friendly', 'João', 'openai');
        console.log("OpenAI Reply:", openaiReply);
    } catch (e: any) {
        console.error("OpenAI failed:");
        console.error(JSON.stringify(e, null, 2) || e.message || e);
    }

    console.log("\n--- Testing Gemini (Gemini 3 Flash) ---");
    try {
        const geminiReply = await commentsService.generateAiReply(comment, videoTitle, 'friendly', 'João', 'gemini');
        console.log("Gemini Reply:", geminiReply);
    } catch (e: any) {
        console.error("Gemini failed:");
        console.error(JSON.stringify(e, null, 2) || e.message || e);
    }

    await app.close();
}

bootstrap();
