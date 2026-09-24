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
import { PermissionsService } from '../permissions/permissions.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginacaoMetadataDto } from '../common/swagger/pagination-response.schema';
import { ProblemDetailsDto } from '../common/swagger/problem-details.schema';
import { CreateRefuelingDto } from './dto/create-refueling.dto';
import { ListRefuelingQueryDto } from './dto/list-refueling-query.dto';
import { RefuelingsService } from './refuelings.service';

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

// Schema de resposta de um abastecimento (não existe DTO de resposta neste
// resource; o service devolve a linha crua do Prisma).
const REFUELING_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    vehicleId: { type: 'string', format: 'uuid' },
    driverId: { type: 'string', format: 'uuid' },
    mileage: { type: 'integer', example: 15230 },
    litersAdded: { type: 'number', example: 45.5 },
    costPerLiter: { type: 'number', example: 5.89 },
    totalCost: { type: 'number', example: 268.05, description: 'Calculado pela procedure (litersAdded x costPerLiter); nunca aceito do cliente.' },
    fuelType: { type: 'string', enum: ['DIESEL', 'GASOLINE', 'ETHANOL', 'HYBRID'], example: 'DIESEL' },
    registeredBy: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    deletedAt: { type: 'string', format: 'date-time', nullable: true, example: null },
  },
};

// Sem PATCH/PUT genérico: abastecimento é registro histórico da procedure
// register_refueling (ver comentário no service). Leitura: quem tiver
// REFUELING_VIEW_OWN ou REFUELING_VIEW_ALL. Criação: REFUELING_CREATE
// (motorista registra o próprio abastecimento). Remoção: só ADMIN.
@ApiTags('refuelings')
@ApiBearerAuth('jwt')
@ApiExtraModels(ProblemDetailsDto, PaginacaoMetadataDto)
@Controller('refuelings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RefuelingsController {
  constructor(
    private servicoRefuelings: RefuelingsService,
    private servicoPermissions: PermissionsService,
  ) {}

  @Get()
  @Permissions('REFUELING_VIEW_OWN', 'REFUELING_VIEW_ALL')
  @ApiOperation({
    summary: 'Lista abastecimentos (paginado)',
    description:
      'Lista abastecimentos ativos (não removidos), paginado, com filtros opcionais por veículo ' +
      'e motorista. Acesso: ADMIN, FLEET_MANAGER (REFUELING_VIEW_ALL, veem tudo, filtro ' +
      '`driverId` livre), DRIVER (REFUELING_VIEW_OWN, só os próprios — o `driverId` da query é ' +
      'ignorado e forçado para o motorista vinculado ao usuário logado; sem Driver vinculado ' +
      'devolve lista vazia).\n\n' +
      '`x-database-tables`: lê `refuelings`.',
    ...({ 'x-database-tables': { read: ['refuelings'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiQuery({ name: 'vehicleId', required: false, type: String, format: 'uuid', description: 'Filtra por veículo.' })
  @ApiQuery({ name: 'driverId', required: false, type: String, format: 'uuid', description: 'Filtra por motorista. Ignorado se o usuário só tiver REFUELING_VIEW_OWN.' })
  @ApiResponse({
    status: 200,
    description: 'Página de abastecimentos.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: REFUELING_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Filtro `vehicleId`/`driverId` fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async listar(
    @Query() query: ListRefuelingQueryDto,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    const codigos = await this.servicoPermissions.obterCodigosEfetivos(
      usuario.userId,
      usuario.roleId,
    );
    const temPermissaoViewAll = codigos.includes('REFUELING_VIEW_ALL');

    return this.servicoRefuelings.listar(
      query.page,
      query.pageSize,
      query.vehicleId,
      query.driverId,
      { userId: usuario.userId, temPermissaoViewAll },
    );
  }

  // Precisa vir antes de "GET /:id", senão "deleted" seria lido como um id.
  @Get('deleted/all')
  @Permissions('REFUELING_RESTORE')
  @ApiOperation({
    summary: 'Lista abastecimentos removidos (soft delete), paginado',
    description:
      'Lista abastecimentos já removidos logicamente (deletedAt preenchido), paginado. Acesso: permission `REFUELING_RESTORE` (ADMIN por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `refuelings`.',
    ...({ 'x-database-tables': { read: ['refuelings'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de abastecimentos removidos.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: REFUELING_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarRemovidos(@Query() paginacao: PaginationQueryDto) {
    return this.servicoRefuelings.listarRemovidos(
      paginacao.page,
      paginacao.pageSize,
    );
  }

  @Get(':id')
  @Permissions('REFUELING_VIEW_OWN', 'REFUELING_VIEW_ALL')
  @ApiOperation({
    summary: 'Busca um abastecimento por id',
    description:
      'Busca um abastecimento ativo pelo id. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      '`x-database-tables`: lê `refuelings`.',
    ...({ 'x-database-tables': { read: ['refuelings'] } } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do abastecimento (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Abastecimento encontrado.', schema: REFUELING_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Abastecimento não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoRefuelings.buscarPorId(id);
  }

  @Post()
  @Permissions('REFUELING_CREATE')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Registra um abastecimento',
    description:
      'Regras: `mileage` (hodômetro; > 0 e não menor que a atual do veículo), `litersAdded` (> 0), `costPerLiter` (> 0) e `fuelType` (DIESEL, GASOLINE, ETHANOL, HYBRID); veículo fora de serviço é recusado; motorista precisa estar ativo e, se o veículo está em viagem ativa, ser o da viagem. ' +
      'Chama a procedure `register_refueling`, que calcula `totalCost = round(litersAdded x ' +
      'costPerLiter, 2)` e atualiza `vehicles.currentMileage` — `totalCost` não é aceito do cliente, ' +
      'nem existe no corpo da requisição. Sem `PATCH`/`PUT`: abastecimento é registro histórico; ' +
      'editar a quilometragem depois desincronizaria `vehicles.currentMileage` (o trigger de ' +
      'sincronia dispara de novo em qualquer UPDATE de mileage). Corrigir um lançamento errado é ' +
      'apagar (`DELETE`) e recriar, não editar. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      'Erros mais prováveis da procedure (SQLSTATE P0001, traduzidos para HTTP): veículo ou ' +
      'motorista não encontrado (404), motorista inativo (409), quilometragem menor que a atual ' +
      'do veículo (409), litros/preço fora do intervalo permitido (400), tipo de combustível ' +
      'inválido (400), motorista não corresponde à viagem ativa do veículo (409).\n\n' +
      '`x-database-tables`: lê `drivers`, `vehicles`; escreve em `refuelings` e `vehicles` ' +
      '(procedure `register_refueling`).',
    ...({
      'x-database-tables': {
        read: ['drivers', 'vehicles'],
        write: ['refuelings', 'vehicles'],
      },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: CreateRefuelingDto })
  @ApiResponse({ status: 201, description: 'Abastecimento registrado.', schema: REFUELING_SCHEMA })
  @ApiResponse({ status: 400, description: 'Corpo inválido, ou erro de validação da procedure (ex: litros/preço fora do limite, tipo de combustível inválido).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: '`vehicleId` ou `driverId` não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({
    status: 409,
    description: 'Motorista inativo, quilometragem informada menor que a atual do veículo, ou motorista não corresponde à viagem ativa do veículo.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  criar(@Body() dados: CreateRefuelingDto, @CurrentUser() usuario: UsuarioLogado) {
    return this.servicoRefuelings.criar(dados, usuario.userId);
  }

  @Delete(':id')
  @Permissions('REFUELING_DELETE')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um abastecimento (soft delete)',
    description:
      'Marca `deletedAt` no abastecimento; a linha continua no banco e pode ser restaurada em ' +
      '`PATCH /refuelings/:id/restore`. Acesso: permission `REFUELING_DELETE` (ADMIN por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `refuelings`; escreve em `refuelings`.',
    ...({
      'x-database-tables': { read: ['refuelings'], write: ['refuelings'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do abastecimento (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Abastecimento removido (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Abastecimento não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoRefuelings.remover(id);
  }

  @Patch(':id/restore')
  @Permissions('REFUELING_RESTORE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaura um abastecimento removido',
    description:
      'Limpa `deletedAt`, revertendo o soft delete. Acesso: permission `REFUELING_RESTORE` (ADMIN por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `refuelings`; escreve em `refuelings`.',
    ...({
      'x-database-tables': { read: ['refuelings'], write: ['refuelings'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do abastecimento (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Abastecimento restaurado.', schema: REFUELING_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Abastecimento não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  restaurar(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoRefuelings.restaurar(id);
  }

  // Irreversível: apaga a linha de verdade do banco (hard delete).
  @Delete(':id/permanent')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um abastecimento permanentemente (hard delete)',
    description:
      'Apaga a linha de verdade do banco — irreversível, diferente do `DELETE /refuelings/:id` ' +
      '(soft delete). Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `refuelings`; escreve (apaga) em `refuelings`.',
    ...({
      'x-database-tables': { read: ['refuelings'], write: ['refuelings'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do abastecimento (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Abastecimento apagado definitivamente (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Abastecimento não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async removerPermanentemente(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoRefuelings.removerPermanentemente(id);
  }
}
