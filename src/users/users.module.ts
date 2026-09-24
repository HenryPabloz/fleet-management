import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, SoftDeleteService],
  // Exportado para o PermissionsModule reaproveitar buscarPorId (não duplicar a query).
  exports: [UsersService],
})
export class UsersModule {}
