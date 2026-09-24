import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UsuarioLogado } from '../auth/interfaces/usuario-logado.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginacaoMetadataDto } from '../common/swagger/pagination-response.schema';
import { ProblemDetailsDto } from '../common/swagger/problem-details.schema';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { ListMaintenanceQueryDto } from './dto/list-maintenance-query.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import { MaintenancesService } from './maintenances.service';

// Query de paginação comum às rotas de listagem (GET / e GET /deleted/all).
const QUERY_PAGE = {
  name: 'page',
  required: false,
  type: Number,
  description: 'Número da página (começa em 1). Padrão: 1.',
  example: 1,
};
const QUERY_PAGE_SIZE = {
  name: 'pageSize',
  required: false,
  type: Number,
  description: 'Itens por página (1 a 100). Padrão: 20.',
  example: 20,
};

// Schema de resposta de uma manutenção (não existe DTO de resposta neste
// resource; o service devolve a linha crua do Prisma).
const MAINTENANCE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    vehicleId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'], example: 'PREVENTIVE' },
    status: { type: 'string', enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'], example: 'SCHEDULED' },
    scheduledDate: { type: 'string', format: 'date-time' },
    completedDate: { type: 'string', format: 'date-time', nullable: true, example: null },
    description: { type: 'string', example: 'Troca de óleo e filtros' },
    cost: { type: 'number', example: 350.9 },
    registeredBy: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    isActive: { type: 'boolean', example: true, readOnly: true, description: 'Somente leitura: vira false no soft delete e true no restore (não é alterável por PATCH/PUT).' },
    deletedAt: { type: 'string', format: 'date-time', nullable: true, example: null },
  },
};

// Manutenção não é assunto de motorista: leitura (MAINTENANCE_VIEW_ALL),
// criação (MAINTENANCE_CREATE) e atualização (MAINTENANCE_UPDATE) ficam com
// quem tiver a permission (ADMIN e FLEET_MANAGER por papel).
@ApiTags('maintenances')
@ApiBearerAuth('jwt')
@ApiExtraModels(ProblemDetailsDto, PaginacaoMetadataDto)
@Controller('maintenances')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MaintenancesController {
  constructor(private servicoMaintenances: MaintenancesService) {}

  @Get()
  @Permissions('MAINTENANCE_VIEW_ALL')
  @ApiOperation({
    summary: 'Lista manutenções (paginado)',
    description:
      'Lista manutenções ativas (não removidas), paginado, com filtros opcionais por status e ' +
      'veículo. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `maintenances`.',
    ...({ 'x-database-tables': { read: ['maintenances'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiQuery({ name: 'status', required: false, enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'], description: 'Filtra por status da manutenção.' })
  @ApiQuery({ name: 'vehicleId', required: false, type: String, format: 'uuid', description: 'Filtra por veículo.' })
  @ApiResponse({
    status: 200,
    description: 'Página de manutenções.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: MAINTENANCE_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Filtro `vehicleId` fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listar(@Query() query: ListMaintenanceQueryDto) {
    return this.servicoMaintenances.listar(
      query.page,
      query.pageSize,
      query.status,
      query.vehicleId,
    );
  }

  // Precisa vir antes de "GET /:id", senão "deleted" seria lido como um id.
  @Get('deleted/all')
  @Permissions('MAINTENANCE_RESTORE')
  @ApiOperation({
    summary: 'Lista manutenções removidas (soft delete), paginado',
    description:
      'Lista manutenções já removidas logicamente (deletedAt preenchido), paginado. Acesso: permission `MAINTENANCE_RESTORE` (ADMIN; FLEET_MANAGER por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `maintenances`.',
    ...({ 'x-database-tables': { read: ['maintenances'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de manutenções removidas.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: MAINTENANCE_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarRemovidos(@Query() paginacao: PaginationQueryDto) {
    return this.servicoMaintenances.listarRemovidos(
      paginacao.page,
      paginacao.pageSize,
    );
  }

  @Get(':id')
  @Permissions('MAINTENANCE_VIEW_ALL')
  @ApiOperation({
    summary: 'Busca uma manutenção por id',
    description:
      'Busca uma manutenção ativa pelo id. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `maintenances`.',
    ...({ 'x-database-tables': { read: ['maintenances'] } } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da manutenção (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Manutenção encontrada.', schema: MAINTENANCE_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Manutenção não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoMaintenances.buscarPorId(id);
  }

  @Post()
  @Permissions('MAINTENANCE_CREATE')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Cria uma manutenção',
    description:
      '`status` aceita `SCHEDULED`, `IN_PROGRESS` ou `COMPLETED` (padrão: `SCHEDULED`). Se a ' +
      'manutenção nasce ativa (`SCHEDULED`/`IN_PROGRESS`) e o veículo estiver `AVAILABLE`, o ' +
      'veículo é marcado como `IN_MAINTENANCE` automaticamente (sem trigger no banco, isso é ' +
      'feito aqui na aplicação); se o veículo já estiver `IN_USE` ou `OUT_OF_SERVICE`, o status ' +
      'dele não é alterado. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `vehicles` (valida vehicleId); escreve em `maintenances` e, ' +
      'condicionalmente, em `vehicles`.',
    ...({
      'x-database-tables': { read: ['vehicles'], write: ['maintenances', 'vehicles'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: CreateMaintenanceDto })
  @ApiResponse({ status: 201, description: 'Manutenção criada.', schema: MAINTENANCE_SCHEMA })
  @ApiResponse({
    status: 400,
    description: '`vehicleId` inexistente (ou removido), corpo inválido, ou violação de CHECK do banco.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({
    status: 409,
    description: 'Sincronia com o veículo falhou (ex: veículo com viagem ativa).',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  criar(
    @Body() dados: CreateMaintenanceDto,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    return this.servicoMaintenances.criar(dados, usuario.userId);
  }

  @Patch(':id')
  @Permissions('MAINTENANCE_UPDATE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atualiza parcialmente uma manutenção',
    description:
      'Atualiza só os campos enviados (type, status, scheduledDate, completedDate, description, ' +
      'cost). `vehicleId` não entra aqui, o vínculo é fixo após criado. Se `status` mudar para ' +
      '`COMPLETED` (e não estava `COMPLETED` antes), `completedDate` é preenchida com a data ' +
      'atual quando não enviada, `vehicles.lastMaintenanceKm` é sincronizado com a quilometragem ' +
      'atual do veículo, e o veículo volta para `AVAILABLE` se não houver outra manutenção ativa ' +
      'e ele ainda estiver `IN_MAINTENANCE`. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `maintenances`, `vehicles`; escreve em `maintenances` e, ' +
      'condicionalmente, em `vehicles`.',
    ...({
      'x-database-tables': {
        read: ['maintenances', 'vehicles'],
        write: ['maintenances', 'vehicles'],
      },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da manutenção (UUID).', format: 'uuid' })
  @ApiBody({ type: UpdateMaintenanceDto })
  @ApiResponse({ status: 200, description: 'Manutenção atualizada.', schema: MAINTENANCE_SCHEMA })
  @ApiResponse({ status: 400, description: 'Corpo inválido ou violação de CHECK do banco.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Manutenção não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({
    status: 409,
    description: 'Sincronia com o veículo falhou ao concluir a manutenção (ex: veículo com viagem ativa).',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  atualizarParcial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: UpdateMaintenanceDto,
  ) {
    return this.servicoMaintenances.atualizarParcial(id, dados);
  }

  @Delete(':id')
  @Permissions('MAINTENANCE_DELETE')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove uma manutenção (soft delete)',
    description:
      'Marca `deletedAt` na manutenção; a linha continua no banco e pode ser restaurada em ' +
      '`PATCH /maintenances/:id/restore`. Não reverte o status do veículo (só a conclusão da ' +
      'manutenção sincroniza o veículo de volta). Acesso: permission `MAINTENANCE_DELETE` (ADMIN; FLEET_MANAGER por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `maintenances`; escreve em `maintenances`.',
    ...({
      'x-database-tables': { read: ['maintenances'], write: ['maintenances'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da manutenção (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Manutenção removida (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Manutenção não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoMaintenances.remover(id);
  }

  @Patch(':id/restore')
  @Permissions('MAINTENANCE_RESTORE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaura uma manutenção removida',
    description:
      'Limpa `deletedAt`, revertendo o soft delete. Acesso: permission `MAINTENANCE_RESTORE` (ADMIN; FLEET_MANAGER por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `maintenances`; escreve em `maintenances`.',
    ...({
      'x-database-tables': { read: ['maintenances'], write: ['maintenances'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da manutenção (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Manutenção restaurada.', schema: MAINTENANCE_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Manutenção não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  restaurar(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoMaintenances.restaurar(id);
  }

  // Irreversível: apaga a linha de verdade do banco (hard delete).
  @Delete(':id/permanent')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove uma manutenção permanentemente (hard delete)',
    description:
      'Apaga a linha de verdade do banco — irreversível, diferente do `DELETE /maintenances/:id` ' +
      '(soft delete). Acesso: ADMIN (FLEET_MANAGER só faz soft delete).\n\n' +
      '`x-database-tables`: lê `maintenances`; escreve (apaga) em `maintenances`.',
    ...({
      'x-database-tables': { read: ['maintenances'], write: ['maintenances'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da manutenção (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Manutenção apagada definitivamente (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Manutenção não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async removerPermanentemente(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.servicoMaintenances.removerPermanentemente(id);
  }
}
