import { Module } from '@nestjs/common';
import { HotmartController } from './hotmart.controller';
import { HotmartService } from './hotmart.service';

@Module({
    controllers: [HotmartController],
    providers: [HotmartService],
})
export class HotmartModule { }
