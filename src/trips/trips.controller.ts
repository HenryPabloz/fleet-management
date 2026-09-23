import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
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
import { CreateTripDto } from './dto/create-trip.dto';
import { StartTripDto } from './dto/start-trip.dto';
import { EndTripDto } from './dto/end-trip.dto';
import { ListTripQueryDto } from './dto/list-trip-query.dto';
import { TripsService } from './trips.service';

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

// Schema de resposta de uma viagem (não existe DTO de resposta neste
// resource; o service devolve a linha crua do Prisma).
const TRIP_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    driverId: { type: 'string', format: 'uuid' },
    vehicleId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], example: 'PLANNED' },
    startKm: { type: 'integer', example: 15000 },
    endKm: { type: 'integer', nullable: true, example: null },
    startLocation: {
      type: 'string',
      description: 'Endereço resolvido pelo ViaCEP a partir do CEP enviado na criação (não é mais texto livre).',
      example: 'São Paulo, SP',
    },
    endLocation: {
      type: 'string',
      description: 'Endereço resolvido pelo ViaCEP a partir do CEP enviado na criação (não é mais texto livre).',
      example: 'Campinas, SP',
    },
    startTime: { type: 'string', format: 'date-time' },
    endTime: { type: 'string', format: 'date-time', nullable: true, example: null },
    createdBy: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    deletedAt: { type: 'string', format: 'date-time', nullable: true, example: null },
  },
};

// Descrição reaproveitada nas 3 rotas de transição de status: os erros mais
// prováveis que create_trip/start_trip/end_trip/cancel_trip (procedures do
// banco) devolvem, traduzidos via traduzirErroDeProcedure (P0001 -> HTTP).
const ERROS_DE_PROCEDURE_COMUNS =
  'A validação de negócio roda dentro de uma procedure do banco (SQLSTATE P0001), traduzida ' +
  'para HTTP. Os erros mais prováveis: veículo indisponível (em uso, em manutenção ou fora de ' +
  'serviço — 409), motorista inativo ou com CNH vencida (409), motorista/veículo/viagem não ' +
  'encontrado (404), viagem em status incompatível com a transição pedida (409), e dados fora ' +
  'do limite (quilometragem negativa ou maior que o permitido — 400).';

// Sem PUT/PATCH genérico de campos livres: a viagem só muda de estado pelas
// rotas de negócio (start/end/cancel), que chamam as procedures do banco.
// Editar km/local direto quebraria a garantia de consistência das procedures.
//
// Leitura: quem tiver TRIP_VIEW_OWN ou TRIP_VIEW_ALL. Sem TRIP_VIEW_ALL, o
// filtro driverId da query é ignorado e forçado para o motorista logado (ver
// resolver-driver-proprio.util.ts) — motorista só enxerga as próprias viagens.
// Criação: TRIP_CREATE. Cancelamento:
// TRIP_CANCEL_OWN. Start/end não têm código de permission no seed, continuam
// em @Roles. DELETE/restore/permanent: só ADMIN (remoção de dados é decisão
// administrativa; sem código de permission pra isso).
@ApiTags('trips')
@ApiBearerAuth('jwt')
@ApiExtraModels(ProblemDetailsDto, PaginacaoMetadataDto)
@Controller('trips')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TripsController {
  constructor(
    private servicoTrips: TripsService,
    private servicoPermissions: PermissionsService,
  ) {}

  @Get()
  @Permissions('TRIP_VIEW_OWN', 'TRIP_VIEW_ALL')
  @ApiOperation({
    summary: 'Lista viagens (paginado)',
    description:
      'Lista viagens ativas (não removidas), paginado, com filtros opcionais por status, ' +
      'motorista e veículo. Acesso: ADMIN, FLEET_MANAGER (TRIP_VIEW_ALL, veem tudo, filtro ' +
      '`driverId` livre), DRIVER (TRIP_VIEW_OWN, só as próprias viagens — o `driverId` da query ' +
      'é ignorado e forçado para o motorista vinculado ao usuário logado; sem Driver vinculado ' +
      'devolve lista vazia).\n\n' +
      '`x-database-tables`: lê `trips`.',
    ...({ 'x-database-tables': { read: ['trips'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiQuery({ name: 'status', required: false, enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], description: 'Filtra por status da viagem.' })
  @ApiQuery({ name: 'driverId', required: false, type: String, format: 'uuid', description: 'Filtra por motorista. Ignorado se o usuário só tiver TRIP_VIEW_OWN.' })
  @ApiQuery({ name: 'vehicleId', required: false, type: String, format: 'uuid', description: 'Filtra por veículo.' })
  @ApiResponse({
    status: 200,
    description: 'Página de viagens.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: TRIP_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Filtro `driverId`/`vehicleId` fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async listar(
    @Query() query: ListTripQueryDto,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    const codigos = await this.servicoPermissions.obterCodigosEfetivos(
      usuario.userId,
      usuario.roleId,
    );
    const temPermissaoViewAll = codigos.includes('TRIP_VIEW_ALL');

    return this.servicoTrips.listar(
      query.page,
      query.pageSize,
      query.status,
      query.driverId,
      query.vehicleId,
      { userId: usuario.userId, temPermissaoViewAll },
    );
  }

  // Precisa vir antes de "GET /:id", senão "deleted" seria lido como um id.
  @Get('deleted/all')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Lista viagens removidas (soft delete), paginado',
    description:
      'Lista viagens já removidas logicamente (deletedAt preenchido), paginado. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `trips`.',
    ...({ 'x-database-tables': { read: ['trips'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de viagens removidas.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: TRIP_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarRemovidos(@Query() paginacao: PaginationQueryDto) {
    return this.servicoTrips.listarRemovidos(paginacao.page, paginacao.pageSize);
  }

  @Get(':id')
  @Permissions('TRIP_VIEW_OWN', 'TRIP_VIEW_ALL')
  @ApiOperation({
    summary: 'Busca uma viagem por id',
    description:
      'Busca uma viagem ativa pelo id. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      '`x-database-tables`: lê `trips`.',
    ...({ 'x-database-tables': { read: ['trips'] } } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da viagem (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Viagem encontrada.', schema: TRIP_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Viagem não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoTrips.buscarPorId(id);
  }

  @Post()
  @Permissions('TRIP_CREATE')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Cria uma viagem (PLANNED)',
    description:
      'Chama a procedure `create_trip`, que valida motorista (ativo, CNH válida), veículo ' +
      '(disponível) e quilometragem inicial, e já reserva o veículo (`AVAILABLE` -> `IN_USE`). ' +
      'A viagem nasce com status `PLANNED`. `startLocation` e `endLocation` precisam ser um ' +
      '**CEP brasileiro válido** (com ou sem máscara) — não é mais texto livre. Os dois CEPs são ' +
      'validados e resolvidos contra a API real do ViaCEP antes de chamar a procedure, e o que ' +
      'fica gravado na viagem é o endereço resolvido (ex: `"São Paulo, SP"`), não o CEP em si. ' +
      'Não existe `PUT`/`PATCH` genérico de campos livres: a viagem só muda de estado pelas ' +
      'rotas `start`/`end`/`cancel`. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      ERROS_DE_PROCEDURE_COMUNS +
      '\n\n`x-database-tables`: lê `drivers`, `vehicles`; escreve em `trips` e `vehicles` ' +
      '(procedure `create_trip`).',
    ...({
      'x-database-tables': {
        read: ['drivers', 'vehicles'],
        write: ['trips', 'vehicles'],
      },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: CreateTripDto })
  @ApiResponse({ status: 201, description: 'Viagem criada (status PLANNED).', schema: TRIP_SCHEMA })
  @ApiResponse({
    status: 400,
    description:
      'Corpo inválido (ex: `startLocation`/`endLocation` não é um CEP válido ou não encontrado ' +
      'na API do ViaCEP), ou erro de validação da procedure (ex: quilometragem inicial negativa).',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso, ou motorista inativo.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: '`driverId` ou `vehicleId` não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({
    status: 409,
    description: 'Veículo indisponível (em uso, em manutenção ou fora de serviço), motorista inativo, CNH vencida, ou motorista/veículo já com viagem ativa.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({
    status: 500,
    description: 'Erro de rede ao consultar a API do ViaCEP para resolver `startLocation`/`endLocation`.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({
    status: 504,
    description: 'Timeout ou rate limit ao consultar a API do ViaCEP para resolver `startLocation`/`endLocation`.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  criar(@Body() dados: CreateTripDto, @CurrentUser() usuario: UsuarioLogado) {
    return this.servicoTrips.criar(dados, usuario.userId);
  }

  @Patch(':id/start')
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Inicia uma viagem (PLANNED -> IN_PROGRESS)',
    description:
      'Chama a procedure `start_trip` com a quilometragem atual informada. Só funciona em ' +
      'viagens `PLANNED`; qualquer outro status resulta em 409. Acesso: ADMIN, FLEET_MANAGER, ' +
      'DRIVER.\n\n' +
      ERROS_DE_PROCEDURE_COMUNS +
      '\n\n`x-database-tables`: lê `trips`; escreve em `trips` (procedure `start_trip`).',
    ...({
      'x-database-tables': { read: ['trips'], write: ['trips'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da viagem (UUID).', format: 'uuid' })
  @ApiBody({ type: StartTripDto })
  @ApiResponse({ status: 200, description: 'Viagem iniciada (status IN_PROGRESS).', schema: TRIP_SCHEMA })
  @ApiResponse({ status: 400, description: 'Corpo inválido, ou erro de validação da procedure (ex: quilometragem menor que a de início).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Viagem não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Viagem não está em status PLANNED.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  iniciar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: StartTripDto,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    return this.servicoTrips.iniciar(id, dados, usuario.userId);
  }

  @Patch(':id/end')
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Finaliza uma viagem (IN_PROGRESS -> COMPLETED)',
    description:
      'Chama a procedure `end_trip` com a quilometragem final e o local de chegada. Só funciona ' +
      'em viagens `IN_PROGRESS`; qualquer outro status resulta em 409. Acesso: ADMIN, ' +
      'FLEET_MANAGER, DRIVER.\n\n' +
      ERROS_DE_PROCEDURE_COMUNS +
      '\n\n`x-database-tables`: lê `trips`; escreve em `trips` e `vehicles` (procedure `end_trip`).',
    ...({
      'x-database-tables': { read: ['trips'], write: ['trips', 'vehicles'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da viagem (UUID).', format: 'uuid' })
  @ApiBody({ type: EndTripDto })
  @ApiResponse({ status: 200, description: 'Viagem finalizada (status COMPLETED).', schema: TRIP_SCHEMA })
  @ApiResponse({ status: 400, description: 'Corpo inválido, ou erro de validação da procedure (ex: quilometragem final menor que a inicial).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Viagem não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Viagem não está em status IN_PROGRESS.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  finalizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: EndTripDto,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    return this.servicoTrips.finalizar(id, dados, usuario.userId);
  }

  @Patch(':id/cancel')
  @Permissions('TRIP_CANCEL_OWN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancela uma viagem (PLANNED/IN_PROGRESS -> CANCELLED)',
    description:
      'Chama a procedure `cancel_trip`. Só funciona em viagens `PLANNED` ou `IN_PROGRESS`; ' +
      'viagens já `COMPLETED`/`CANCELLED` resultam em 409. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      ERROS_DE_PROCEDURE_COMUNS +
      '\n\n`x-database-tables`: lê `trips`; escreve em `trips` e `vehicles` (procedure `cancel_trip`).',
    ...({
      'x-database-tables': { read: ['trips'], write: ['trips', 'vehicles'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da viagem (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Viagem cancelada (status CANCELLED).', schema: TRIP_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Viagem não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Viagem já está em status COMPLETED ou CANCELLED.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  cancelar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() usuario: UsuarioLogado) {
    return this.servicoTrips.cancelar(id, usuario.userId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove uma viagem (soft delete)',
    description:
      'Marca `deletedAt` na viagem; a linha continua no banco e pode ser restaurada em ' +
      '`PATCH /trips/:id/restore`. Só funciona em viagens já `COMPLETED`/`CANCELLED` — uma ' +
      'viagem `PLANNED`/`IN_PROGRESS` não pode ser removida direto (isso deixaria o veículo ' +
      'preso em `IN_USE` sem viagem ativa de verdade); cancele com ' +
      '`PATCH /trips/:id/cancel` primeiro. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `trips`; escreve em `trips`.',
    ...({
      'x-database-tables': { read: ['trips'], write: ['trips'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da viagem (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Viagem removida (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Viagem não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Viagem ainda está PLANNED ou IN_PROGRESS; cancele antes de remover.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoTrips.remover(id);
  }

  @Patch(':id/restore')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaura uma viagem removida',
    description:
      'Limpa `deletedAt`, revertendo o soft delete. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `trips`; escreve em `trips`.',
    ...({
      'x-database-tables': { read: ['trips'], write: ['trips'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da viagem (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Viagem restaurada.', schema: TRIP_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Viagem não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  restaurar(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoTrips.restaurar(id);
  }

  // Irreversível: apaga a linha de verdade do banco (hard delete).
  @Delete(':id/permanent')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove uma viagem permanentemente (hard delete)',
    description:
      'Apaga a linha de verdade do banco — irreversível, diferente do `DELETE /trips/:id` (soft ' +
      'delete). Bloqueado se existir incidente associado à viagem. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `trips`, `incidents`; escreve (apaga) em `trips`.',
    ...({
      'x-database-tables': { read: ['trips', 'incidents'], write: ['trips'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id da viagem (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Viagem apagada definitivamente (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Viagem não encontrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Viagem tem incidentes associados.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async removerPermanentemente(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoTrips.removerPermanentemente(id);
  }
}
