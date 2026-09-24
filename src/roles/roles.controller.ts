import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ProblemDetailsDto } from '../common/swagger/problem-details.schema';
import { RoleRespostaDto } from './dto/role-response.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth('jwt')
@ApiExtraModels(ProblemDetailsDto, RoleRespostaDto)
@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RolesController {
  constructor(private servicoRoles: RolesService) {}

  @Get()
  @Permissions('USER_CREATE', 'USER_UPDATE')
  @ApiOperation({
    summary: 'Lista os papéis (roles) disponíveis',
    description:
      'Lista os papéis do sistema (id, name, description), ordenados por nome, para montar o campo `roleId` ' +
      'do formulário de usuário. Acesso: quem tem a permissão `USER_CREATE` ou `USER_UPDATE` ' +
      '(ADMIN por papel; FLEET_MANAGER só se receber uma delas por delegação).\n\n' +
      '`x-database-tables`: lê `roles`.',
    ...({ 'x-database-tables': { read: ['roles'] } } as Record<string, unknown>),
  })
  @ApiResponse({ status: 200, description: 'Lista de papéis.', type: [RoleRespostaDto] })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Usuário autenticado não tem a permissão necessária.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listar() {
    return this.servicoRoles.listar();
  }
}
