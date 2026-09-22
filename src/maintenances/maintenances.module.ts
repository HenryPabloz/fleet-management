import { Module } from '@nestjs/common';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { MaintenancesController } from './maintenances.controller';
import { MaintenancesService } from './maintenances.service';

@Module({
  controllers: [MaintenancesController],
  providers: [MaintenancesService, SoftDeleteService],
})
export class MaintenancesModule {}
