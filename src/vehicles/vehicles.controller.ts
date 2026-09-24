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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginacaoMetadataDto } from '../common/swagger/pagination-response.schema';
import { ProblemDetailsDto } from '../common/swagger/problem-details.schema';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListVehicleQueryDto } from './dto/list-vehicle-query.dto';
import { ListVehicleNotInUseQueryDto } from './dto/list-vehicle-not-in-use-query.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehiclesService } from './vehicles.service';

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

// Schema de resposta de um veículo (não existe DTO de resposta neste
// resource; o service devolve a linha crua do Prisma).
const VEHICLE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    plate: { type: 'string', example: 'ABC1D23' },
    model: { type: 'string', example: 'Fiat Strada' },
    year: { type: 'integer', example: 2022 },
    status: {
      type: 'string',
      enum: ['AVAILABLE', 'IN_USE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE'],
      example: 'AVAILABLE',
    },
    currentMileage: { type: 'integer', example: 15000 },
    lastMaintenanceKm: { type: 'integer', example: 10000 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    isActive: { type: 'boolean', example: true, readOnly: true, description: 'Somente leitura: vira false no soft delete e true no restore (não é alterável por PATCH/PUT).' },
    deletedAt: { type: 'string', format: 'date-time', nullable: true, example: null },
  },
};

// Schema de resposta específico do POST: quando o corpo traz `initialLocationCep`,
// o serviço enriquece a resposta com `initialLocation` (endereço resolvido pelo
// ViaCEP), sem persistir isso no banco. Some quando o CEP não é enviado.
const VEHICLE_CREATE_RESPONSE_SCHEMA = {
  allOf: [
    VEHICLE_SCHEMA,
    {
      type: 'object',
      properties: {
        initialLocation: {
          type: 'object',
          description:
            'Só presente quando `initialLocationCep` foi enviado no corpo da requisição. ' +
            'Endereço resolvido pela API do ViaCEP; não é persistido no banco.',
          properties: {
            cep: { type: 'string', example: '01310-100' },
            logradouro: { type: 'string', example: 'Avenida Paulista' },
            complemento: { type: 'string', example: 'lado ímpar' },
            bairro: { type: 'string', example: 'Bela Vista' },
            localidade: { type: 'string', example: 'São Paulo' },
            uf: { type: 'string', example: 'SP' },
            ibge: { type: 'string', example: '3550308' },
            gia: { type: 'string', example: '1004' },
            ddd: { type: 'string', example: '11' },
            siafi: { type: 'string', example: '7107' },
            fullAddress: {
              type: 'string',
              description: 'Endereço resumido (localidade + UF), o mesmo texto gravado como local em viagens.',
              example: 'São Paulo, SP',
            },
          },
        },
      },
    },
  ],
};

// Leitura: ADMIN, FLEET_MANAGER e DRIVER (motorista precisa ver quais veículos
// estão disponíveis). Continua em @Roles: a permission VEHICLE_VIEW do seed não
// cobre DRIVER, então trocar quebraria esse acesso — não convertido de propósito.
// Escrita: quem tiver VEHICLE_CREATE/VEHICLE_UPDATE (ADMIN e FLEET_MANAGER por
// papel; outros papéis podem receber via delegação).
@ApiTags('vehicles')
@ApiBearerAuth('jwt')
@ApiExtraModels(ProblemDetailsDto, PaginacaoMetadataDto)
@Controller('vehicles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VehiclesController {
  constructor(private servicoVehicles: VehiclesService) {}

  @Get()
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @ApiOperation({
    summary: 'Lista veículos (paginado)',
    description:
      'Lista veículos ativos (não removidos), paginado, com filtro opcional por status. ' +
      'Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      '`x-database-tables`: lê `vehicles`.',
    ...({ 'x-database-tables': { read: ['vehicles'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['AVAILABLE', 'IN_USE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE'],
    description: 'Filtra por status do veículo.',
  })
  @ApiResponse({
    status: 200,
    description: 'Página de veículos.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: VEHICLE_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listar(@Query() query: ListVehicleQueryDto) {
    return this.servicoVehicles.listar(query.page, query.pageSize, query.status);
  }

  // As rotas fixas (in-use, not-in-use, deleted/all) precisam vir antes de "GET /:id",
  // senão o texto seria lido como um id.
  @Get('in-use')
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @ApiOperation({
    summary: 'Lista veículos em uso (paginado)',
    description:
      'Veículos com status `IN_USE` (inclui os reservados por uma viagem `PLANNED`, pois a criação da ' +
      'viagem já marca o veículo como em uso). Não aceita filtro `status` (seria redundante). ' +
      'Junto com `GET /vehicles/not-in-use` soma o total de `GET /vehicles`. ' +
      'Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      '`x-database-tables`: lê `vehicles`.',
    ...({ 'x-database-tables': { read: ['vehicles'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de veículos em uso.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: VEHICLE_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarEmUso(@Query() paginacao: PaginationQueryDto) {
    return this.servicoVehicles.listarEmUso(paginacao.page, paginacao.pageSize);
  }

  @Get('not-in-use')
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @ApiOperation({
    summary: 'Lista veículos fora de uso (paginado)',
    description:
      'Veículos com qualquer status diferente de `IN_USE`: `AVAILABLE`, `IN_MAINTENANCE` ou ' +
      '`OUT_OF_SERVICE`. O filtro opcional `status` aceita só esses três valores (`IN_USE` é recusado com 400). ' +
      'Junto com `GET /vehicles/in-use` soma o total de `GET /vehicles`. ' +
      'Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      '`x-database-tables`: lê `vehicles`.',
    ...({ 'x-database-tables': { read: ['vehicles'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['AVAILABLE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE'],
    description: 'Filtra por um status específico dentre os "fora de uso".',
  })
  @ApiResponse({
    status: 200,
    description: 'Página de veículos fora de uso.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: VEHICLE_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Parâmetro inválido (ex: `status=IN_USE`).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarForaDeUso(@Query() query: ListVehicleNotInUseQueryDto) {
    return this.servicoVehicles.listarForaDeUso(query.page, query.pageSize, query.status);
  }

  // Precisa vir antes de "GET /:id", senão "deleted" seria lido como um id.
  @Get('deleted/all')
  @Permissions('VEHICLE_RESTORE')
  @ApiOperation({
    summary: 'Lista veículos removidos (soft delete), paginado',
    description:
      'Lista veículos já removidos logicamente (deletedAt preenchido), paginado. Acesso: permission `VEHICLE_RESTORE` (ADMIN; FLEET_MANAGER por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `vehicles`.',
    ...({ 'x-database-tables': { read: ['vehicles'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de veículos removidos.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: VEHICLE_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarRemovidos(@Query() paginacao: PaginationQueryDto) {
    return this.servicoVehicles.listarRemovidos(
      paginacao.page,
      paginacao.pageSize,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @ApiOperation({
    summary: 'Busca um veículo por id',
    description:
      'Busca um veículo ativo pelo id. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      '`x-database-tables`: lê `vehicles`.',
    ...({ 'x-database-tables': { read: ['vehicles'] } } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do veículo (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Veículo encontrado.', schema: VEHICLE_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoVehicles.buscarPorId(id);
  }

  @Post()
  @Permissions('VEHICLE_CREATE')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Cria um veículo',
    description:
      'Cria um veículo novo. `status` aceita apenas `AVAILABLE`, `IN_MAINTENANCE` ou ' +
      '`OUT_OF_SERVICE` (padrão: `AVAILABLE`) — `IN_USE` nunca é aceito via API, esse status ' +
      'só é setado pelas procedures de viagem (`start_trip`) quando o veículo entra em uso. ' +
      'A placa é única. Aceita opcionalmente `initialLocationCep`: se enviado, é validado contra ' +
      'a API real do ViaCEP e o endereço resolvido volta no campo `initialLocation` da resposta ' +
      '— isso só enriquece a resposta, não é persistido no banco (não existe coluna para isso em ' +
      '`vehicles`). Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `vehicles` (checa placa duplicada); escreve em `vehicles`.',
    ...({
      'x-database-tables': { read: ['vehicles'], write: ['vehicles'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: CreateVehicleDto })
  @ApiResponse({
    status: 201,
    description: 'Veículo criado. `initialLocation` só aparece quando `initialLocationCep` foi enviado.',
    schema: VEHICLE_CREATE_RESPONSE_SCHEMA,
  })
  @ApiResponse({
    status: 400,
    description:
      'Corpo inválido (ex: ano fora do intervalo, placa fora do padrão, `initialLocationCep` ' +
      'inválido ou não encontrado na API do ViaCEP) ou violação de CHECK do banco.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Placa já cadastrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({
    status: 500,
    description: 'Erro de rede ao consultar a API do ViaCEP (só quando `initialLocationCep` foi enviado).',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({
    status: 504,
    description: 'Timeout ou rate limit ao consultar a API do ViaCEP (só quando `initialLocationCep` foi enviado).',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  criar(@Body() dados: CreateVehicleDto) {
    return this.servicoVehicles.criar(dados);
  }

  @Patch(':id')
  @Permissions('VEHICLE_UPDATE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atualiza parcialmente um veículo',
    description:
      'Atualiza só os campos enviados (model, year, status, currentMileage, lastMaintenanceKm). ' +
      '`plate` não entra aqui, a placa não muda depois de criada. `status` nunca aceita `IN_USE` ' +
      'via API (só as procedures de viagem setam esse status); um trigger do banco bloqueia essa ' +
      'escrita direta. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `vehicles`; escreve em `vehicles`.',
    ...({
      'x-database-tables': { read: ['vehicles'], write: ['vehicles'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do veículo (UUID).', format: 'uuid' })
  @ApiBody({ type: UpdateVehicleDto })
  @ApiResponse({ status: 200, description: 'Veículo atualizado.', schema: VEHICLE_SCHEMA })
  @ApiResponse({ status: 400, description: 'Corpo inválido ou violação de CHECK do banco.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({
    status: 409,
    description: 'Tentativa de setar `status: IN_USE` direto, quilometragem menor que a atual, ou veículo com viagem ativa.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  atualizarParcial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: UpdateVehicleDto,
  ) {
    return this.servicoVehicles.atualizarParcial(id, dados);
  }

  @Delete(':id')
  @Permissions('VEHICLE_DELETE')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um veículo (soft delete)',
    description:
      'Marca `deletedAt` no veículo; a linha continua no banco e pode ser restaurada em ' +
      '`PATCH /vehicles/:id/restore`. Bloqueado se o veículo estiver com status `IN_USE` ' +
      '(viagem ativa). Acesso: permission `VEHICLE_DELETE` (ADMIN; FLEET_MANAGER por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `vehicles`; escreve em `vehicles`.',
    ...({
      'x-database-tables': { read: ['vehicles'], write: ['vehicles'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do veículo (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Veículo removido (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Veículo está em uso (viagem ativa); não pode ser removido.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoVehicles.remover(id);
  }

  @Patch(':id/restore')
  @Permissions('VEHICLE_RESTORE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaura um veículo removido',
    description:
      'Limpa `deletedAt`, revertendo o soft delete. Acesso: permission `VEHICLE_RESTORE` (ADMIN; FLEET_MANAGER por papel; delegável a outros usuários).\n\n' +
      '`x-database-tables`: lê `vehicles`; escreve em `vehicles`.',
    ...({
      'x-database-tables': { read: ['vehicles'], write: ['vehicles'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do veículo (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Veículo restaurado.', schema: VEHICLE_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  restaurar(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoVehicles.restaurar(id);
  }

  // Irreversível: apaga a linha de verdade do banco (hard delete).
  @Delete(':id/permanent')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um veículo permanentemente (hard delete)',
    description:
      'Apaga a linha de verdade do banco — irreversível, diferente do `DELETE /vehicles/:id` ' +
      '(soft delete). Bloqueado se existir viagem, abastecimento, manutenção ou incidente ' +
      'associado ao veículo (a FK não tem ON DELETE CASCADE). Acesso: ADMIN (FLEET_MANAGER só faz soft delete).\n\n' +
      '`x-database-tables`: lê `vehicles`, `trips`, `refuelings`, `maintenances`, `incidents`; ' +
      'escreve (apaga) em `vehicles`.',
    ...({
      'x-database-tables': {
        read: ['vehicles', 'trips', 'refuelings', 'maintenances', 'incidents'],
        write: ['vehicles'],
      },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do veículo (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Veículo apagado definitivamente (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({
    status: 409,
    description: 'Veículo tem viagens, abastecimentos, manutenções ou incidentes associados.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  async removerPermanentemente(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.servicoVehicles.removerPermanentemente(id);
  }
}
