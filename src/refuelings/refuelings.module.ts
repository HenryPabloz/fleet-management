import { Module } from '@nestjs/common';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { RefuelingsController } from './refuelings.controller';
import { RefuelingsService } from './refuelings.service';

@Module({
  controllers: [RefuelingsController],
  providers: [RefuelingsService, SoftDeleteService],
  exports: [RefuelingsService],
})
export class RefuelingsModule {}
