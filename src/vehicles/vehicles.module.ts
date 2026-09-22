import { Module } from '@nestjs/common';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, SoftDeleteService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
