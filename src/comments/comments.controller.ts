import { Controller, Post, Body, Get, Delete, Param, Put, HttpException, HttpStatus } from '@nestjs/common';
import { CommentsService } from './comments.service';

@Controller('comments')
export class CommentsController {
    constructor(private readonly commentsService: CommentsService) { }

    @Post('generate-reply')
    async generateReply(@Body() body: { commentText: string, videoTitle?: string, style?: string, authorName?: string, provider?: 'openai' | 'gemini' }) {
        return await this.commentsService.generateAiReply(body.commentText, body.videoTitle, body.style, body.authorName, body.provider || 'openai');
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

    @Post('learn')
    async learnReply(@Body() body: { commentText: string, replyText: string, username?: string }) {
        return await this.commentsService.learnReply(body.commentText, body.replyText, body.username);
    }

    @Get('interactions/:username')
    async getInteractionCount(@Param('username') username: string) {
        const count = await this.commentsService.getInteractionCount(username);
        return { count };
    }

    @Get('top-commenters')
    async getTopCommenters() {
        return await this.commentsService.getTopCommenters(5);
    }

    @Get('history/:username')
    async getUserHistory(@Param('username') username: string) {
        return await this.commentsService.getUserHistory(username);
    }

    @Post('favorites/toggle')
    async toggleFavorite(@Body() commentData: any) {
        return await this.commentsService.toggleFavorite(commentData);
    }

    @Get('favorites')
    async getFavorites() {
        return await this.commentsService.getFavorites();
    }
}
