import { Module } from '@nestjs/common';
import { OpenaiModule } from '../openai/openai.module';
import { AttributionController, ClosersController, VideoTypesController } from './attribution.controller';
import { AttributionService } from './attribution.service';
import { ClosersService } from './closers.service';
import { VideoTypesService } from './video-types.service';

@Module({
    imports: [OpenaiModule],
    controllers: [AttributionController, ClosersController, VideoTypesController],
    providers: [AttributionService, ClosersService, VideoTypesService],
    exports: [AttributionService],
})
export class AttributionModule { }
