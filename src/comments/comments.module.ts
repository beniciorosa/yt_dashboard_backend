import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { OpenaiModule } from '../openai/openai.module';
import { GeminiModule } from '../gemini/gemini.module';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [
        OpenaiModule,
        GeminiModule,
        ConfigModule
    ],
    controllers: [CommentsController],
    providers: [CommentsService],
})
export class CommentsModule { }
