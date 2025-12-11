import { Module } from '@nestjs/common';
import { UtmController } from './utm.controller';
import { UtmService } from './utm.service';
import { OpenaiModule } from '../openai/openai.module';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [OpenaiModule, ConfigModule],
    controllers: [UtmController],
    providers: [UtmService],
})
export class UtmModule { }
