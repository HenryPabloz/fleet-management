import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../common/swagger/problem-details.schema';
import { ConcederPermissionDto } from './dto/conceder-permission.dto';
import { PermissionRespostaDto, PermissoesDoUsuarioRespostaDto } from './dto/permission-response.dto';
import { PermissionsService } from './permissions.service';

// Gestão da delegação granular de permissões (tabela user_permissions).
// Todas as rotas são ADMIN-only: a própria concessão não é delegável, para
// não abrir escalonamento em cadeia (um FLEET_MANAGER com USER_CREATE não
// pode, por causa disso, conceder permissões pra ninguém).
@ApiTags('permissions')
@ApiBearerAuth('jwt')
@ApiExtraModels(ProblemDetailsDto, PermissionRespostaDto, PermissoesDoUsuarioRespostaDto)
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PermissionsController {
  constructor(private servicoPermissions: PermissionsService) {}

  @Get('permissions')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Lista o catálogo completo de permissões',
    description:
      'Lista todas as permissões existentes no sistema (id, code, description). Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `permissions`.',
    ...({ 'x-database-tables': { read: ['permissions'] } } as Record<string, unknown>),
  })
  @ApiResponse({ status: 200, description: 'Catálogo de permissões.', type: [PermissionRespostaDto] })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarCatalogo() {
    return this.servicoPermissions.listarCatalogo();
  }

  @Get('users/:id/permissions')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Lista as permissões efetivas de um usuário',
    description:
      'Devolve as permissões herdadas do papel (`fromRole`) e as concedidas individualmente ' +
      '(`individual`) do usuário `:id`, separadas para deixar claro a origem de cada uma. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `users`, `role_permissions`, `user_permissions`.',
    ...({
      'x-database-tables': { read: ['users', 'role_permissions', 'user_permissions'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Permissões efetivas do usuário.', type: PermissoesDoUsuarioRespostaDto })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarPermissoesDoUsuario(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoPermissions.listarPermissoesDoUsuario(id);
  }

  @Post('users/:id/permissions')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Concede uma permissão individualmente a um usuário',
    description:
      'Concede a permissão de código `permissionCode` diretamente ao usuário `:id` (delegação ' +
      'granular, sem prazo de validade — concessão manual e permanente até ser revogada). ' +
      'Idempotente: conceder de novo uma permissão já concedida não é erro, só confirma. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `users`, `permissions`; escreve em `user_permissions`.',
    ...({
      'x-database-tables': { read: ['users', 'permissions'], write: ['user_permissions'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiBody({ type: ConcederPermissionDto })
  @ApiResponse({ status: 200, description: 'Permissão concedida (ou já estava). Devolve as permissões efetivas atualizadas.', type: PermissoesDoUsuarioRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido ou `permissionCode` inexistente.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  conceder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: ConcederPermissionDto,
  ) {
    return this.servicoPermissions.conceder(id, dados.permissionCode);
  }

  @Delete('users/:id/permissions/:code')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoga a concessão individual de uma permissão',
    description:
      'Remove a concessão individual (linha em `user_permissions`) da permissão `:code` para o ' +
      'usuário `:id`. Não afeta permissões herdadas do papel. Idempotente por escolha: devolve ' +
      '204 mesmo se a permissão já não estava concedida (evita vazar informação e simplifica o ' +
      'cliente, que não precisa checar antes de revogar). Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `users`, `permissions`; escreve (apaga) em `user_permissions`.',
    ...({
      'x-database-tables': { read: ['users', 'permissions'], write: ['user_permissions'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiParam({ name: 'code', description: 'Código da permissão a revogar.', example: 'USER_CREATE' })
  @ApiResponse({ status: 204, description: 'Permissão revogada (ou já não estava concedida). Sem corpo de resposta.' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async revogar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code') code: string,
  ): Promise<void> {
    await this.servicoPermissions.revogar(id, code);
  }
}
