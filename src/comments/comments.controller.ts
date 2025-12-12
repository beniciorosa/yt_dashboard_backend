import { Controller, Post, Body, Get, Delete, Param, Put, HttpException, HttpStatus } from '@nestjs/common';
import { CommentsService } from './comments.service';

@Controller('comments')
export class CommentsController {
    constructor(private readonly commentsService: CommentsService) { }

    @Post('generate-reply')
    async generateReply(@Body() body: { commentText: string, videoTitle?: string, style?: string }) {
        return await this.commentsService.generateAiReply(body.commentText, body.videoTitle, body.style);
    }

    @Get('quick-replies')
    async getQuickReplies() {
        return await this.commentsService.getQuickReplies();
    }

    @Post('quick-replies')
    async createQuickReply(@Body() body: { title: string, text: string }) {
        return await this.commentsService.saveQuickReply(body.title, body.text);
    }

    @Delete('quick-replies/:id')
    async deleteQuickReply(@Param('id') id: string) {
        return await this.commentsService.deleteQuickReply(id);
    }
}
