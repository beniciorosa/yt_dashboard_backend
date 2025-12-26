import { Module } from '@nestjs/common';
import { GeniusService } from './genius.service';
import { GeniusController } from './genius.controller';
import { OpenaiModule } from '../openai/openai.module';

@Module({
    imports: [OpenaiModule],
    controllers: [GeniusController],
    providers: [GeniusService],
})
export class GeniusModule { }
