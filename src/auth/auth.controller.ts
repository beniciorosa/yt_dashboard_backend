import { Controller, Post, Get, Patch, Param, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('admin/create-user')
    async createUser(
        @Headers('authorization') authHeader: string,
        @Body() body: { email: string; password?: string; role?: string }
    ) {
        if (!authHeader) throw new HttpException('Missing authorization header', HttpStatus.UNAUTHORIZED);
        const token = authHeader.replace('Bearer ', '');

        try {
            return await this.authService.createUser(token, body);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.FORBIDDEN);
        }
    }

    @Patch('admin/users/:id/role')
    async setRole(@Headers('authorization') authHeader: string, @Param('id') id: string, @Body() body: { role: string }) {
        if (!authHeader) throw new HttpException('Missing authorization header', HttpStatus.UNAUTHORIZED);
        try {
            return await this.authService.setRole(authHeader.replace('Bearer ', ''), id, body?.role);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.FORBIDDEN);
        }
    }

    @Get('admin/users')
    async listUsers(@Headers('authorization') authHeader: string) {
        if (!authHeader) throw new HttpException('Missing authorization header', HttpStatus.UNAUTHORIZED);
        const token = authHeader.replace('Bearer ', '');

        try {
            return await this.authService.listUsers(token);
        } catch (error: any) {
            throw new HttpException(error.message, HttpStatus.FORBIDDEN);
        }
    }
}
