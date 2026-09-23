import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

// Global: a RolesGuard (usada em @UseGuards de todo controller, sem import
// explícito de módulo) e os controllers de trips/refuelings/incidents
// precisam injetar PermissionsService.obterCodigosEfetivos() para checar
// permissões OWN vs ALL, sem cada módulo ter que importar PermissionsModule.
@Global()
@Module({
  imports: [UsersModule],
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
