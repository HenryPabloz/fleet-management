import { Module } from '@nestjs/common';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService, SoftDeleteService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
