import { Module } from '@nestjs/common';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { GcsStorageService } from '../common/services/gcs-storage.service';
import { ViaCepModule } from '../external/viacep/via-cep.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [ViaCepModule],
  controllers: [TripsController],
  providers: [TripsService, SoftDeleteService, GcsStorageService],
  exports: [TripsService],
})
export class TripsModule {}
