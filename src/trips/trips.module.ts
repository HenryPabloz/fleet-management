import { Module } from '@nestjs/common';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  controllers: [TripsController],
  providers: [TripsService, SoftDeleteService],
  exports: [TripsService],
})
export class TripsModule {}
