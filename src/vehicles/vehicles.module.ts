import { Module } from '@nestjs/common';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { ViaCepModule } from '../external/viacep/via-cep.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [ViaCepModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, SoftDeleteService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
