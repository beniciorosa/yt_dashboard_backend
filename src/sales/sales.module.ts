import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { OpenaiModule } from '../openai/openai.module';

@Module({
  imports: [ConfigModule, OpenaiModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule { }
