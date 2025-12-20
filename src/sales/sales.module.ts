import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';

@Module({
  imports: [ConfigModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule { }
