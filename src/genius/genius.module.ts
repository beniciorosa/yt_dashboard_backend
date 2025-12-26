import { Module } from '@nestjs/common';
import { GeniusService } from './genius.service';
import { GeniusController } from './genius.controller';

@Module({
    controllers: [GeniusController],
    providers: [GeniusService],
})
export class GeniusModule { }
