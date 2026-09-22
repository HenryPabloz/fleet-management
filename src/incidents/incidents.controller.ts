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
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UsuarioLogado } from '../auth/interfaces/usuario-logado.interface';
import type { ConfigVars } from '../config/configuration';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginacaoMetadataDto } from '../common/swagger/pagination-response.schema';
import { ErroPadraoDto } from '../common/swagger/erro-padrao.schema';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';
import { ListIncidentQueryDto } from './dto/list-incident-query.dto';
import { IncidentsService } from './incidents.service';
import { MulterErrorFilter } from './utils/multer-erro.filter';
import { configuracaoDeUploadDeIncidente } from './utils/upload-incidents.config';

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

// Schema de resposta de um incidente (não existe DTO de resposta neste
// resource; o service devolve a linha crua do Prisma).
const INCIDENT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tripId: { type: 'string', format: 'uuid', nullable: true, example: null },
    vehicleId: { type: 'string', format: 'uuid' },
    driverId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['ACCIDENT', 'MECHANICAL_FAILURE', 'OTHER'], example: 'MECHANICAL_FAILURE' },
    severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], example: 'MEDIUM' },
    status: { type: 'string', enum: ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'], example: 'REPORTED' },
    description: { type: 'string', example: 'Pane no motor durante a viagem' },
    photoUrl: { type: 'string', nullable: true, example: 'http://localhost:3000/uploads/incidents/9c3b...jpg' },
    photoKey: { type: 'string', nullable: true, example: '9c3b1e2a-....jpg' },
    registeredBy: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    deletedAt: { type: 'string', format: 'date-time', nullable: true, example: null },
  },
};

// Leitura e criação: ADMIN, FLEET_MANAGER e DRIVER (motorista reporta o
// próprio incidente). Mudar status e remover: só ADMIN e FLEET_MANAGER
// (investigar/resolver um incidente é decisão de gestão, não do motorista).
@ApiTags('incidents')
@ApiBearerAuth('jwt')
@ApiExtraModels(ErroPadraoDto, PaginacaoMetadataDto)
@Controller('incidents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IncidentsController {
  constructor(
    private servicoIncidents: IncidentsService,
    private servicoDeConfiguracao: ConfigService<ConfigVars, true>,
  ) {}

  @Get()
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @ApiOperation({
    summary: 'Lista incidentes (paginado)',
    description:
      'Lista incidentes ativos (não removidos), paginado, com filtros opcionais por severidade, ' +
      'status e veículo. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      '`x-database-tables`: lê `incidents`.',
    ...({ 'x-database-tables': { read: ['incidents'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiQuery({ name: 'severity', required: false, enum: ['LOW', 'MEDIUM', 'HIGH'], description: 'Filtra por severidade.' })
  @ApiQuery({ name: 'status', required: false, enum: ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'], description: 'Filtra por status.' })
  @ApiQuery({ name: 'vehicleId', required: false, type: String, format: 'uuid', description: 'Filtra por veículo.' })
  @ApiResponse({
    status: 200,
    description: 'Página de incidentes.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: INCIDENT_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Filtro `vehicleId` fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  listar(@Query() query: ListIncidentQueryDto) {
    return this.servicoIncidents.listar(
      query.page,
      query.pageSize,
      query.severity,
      query.status,
      query.vehicleId,
    );
  }

  // Precisa vir antes de "GET /:id", senão "deleted" seria lido como um id.
  @Get('deleted/all')
  @Roles('ADMIN', 'FLEET_MANAGER')
  @ApiOperation({
    summary: 'Lista incidentes removidos (soft delete), paginado',
    description:
      'Lista incidentes já removidos logicamente (deletedAt preenchido), paginado. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `incidents`.',
    ...({ 'x-database-tables': { read: ['incidents'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de incidentes removidos.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: INCIDENT_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  listarRemovidos(@Query() paginacao: PaginationQueryDto) {
    return this.servicoIncidents.listarRemovidos(
      paginacao.page,
      paginacao.pageSize,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @ApiOperation({
    summary: 'Busca um incidente por id',
    description:
      'Busca um incidente ativo pelo id. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      '`x-database-tables`: lê `incidents`.',
    ...({ 'x-database-tables': { read: ['incidents'] } } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do incidente (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Incidente encontrado.', schema: INCIDENT_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Incidente não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoIncidents.buscarPorId(id);
  }

  @Post()
  @Roles('ADMIN', 'FLEET_MANAGER', 'DRIVER')
  @HttpCode(201)
  @UseFilters(MulterErrorFilter)
  @UseInterceptors(FileInterceptor('photo', configuracaoDeUploadDeIncidente))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Registra um incidente (com foto opcional)',
    description:
      'Corpo `multipart/form-data`, não JSON puro: os campos do `CreateIncidentDto` vão como ' +
      'campos de formulário, e a foto (opcional) vai no campo de arquivo `photo` (aceita ' +
      'image/jpeg, image/png ou application/pdf, até 10MB). Se enviada, a foto é salva em disco ' +
      '(`uploads/incidents/`) e o registro guarda `photoUrl`/`photoKey`; sem foto, os dois campos ' +
      'ficam `null`. Chama a procedure `register_incident`. Acesso: ADMIN, FLEET_MANAGER, DRIVER.\n\n' +
      'Erros mais prováveis da procedure (SQLSTATE P0001, traduzidos para HTTP): veículo ou ' +
      'motorista não encontrado (404), motorista inativo (409), `tripId` informado mas motorista ' +
      'não corresponde ao motorista da viagem, ou viagem não está IN_PROGRESS (409), tipo/' +
      'severidade inválidos ou descrição vazia/longa demais (400). Arquivo de tipo ou tamanho ' +
      'inválido é barrado antes da procedure, também com 400.\n\n' +
      '`x-database-tables`: lê `vehicles`, `drivers`, `trips` (quando `tripId` informado); ' +
      'escreve em `incidents` (procedure `register_incident`).',
    ...({
      'x-database-tables': {
        read: ['vehicles', 'drivers', 'trips'],
        write: ['incidents'],
      },
    } as Record<string, unknown>),
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['vehicleId', 'driverId', 'type', 'severity', 'description'],
      properties: {
        tripId: { type: 'string', format: 'uuid', nullable: true, description: 'Viagem relacionada (opcional).' },
        vehicleId: { type: 'string', format: 'uuid' },
        driverId: { type: 'string', format: 'uuid' },
        type: { type: 'string', enum: ['ACCIDENT', 'MECHANICAL_FAILURE', 'OTHER'] },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        description: { type: 'string', maxLength: 1000, example: 'Pane no motor durante a viagem' },
        photo: {
          type: 'string',
          format: 'binary',
          description: 'Foto do incidente (opcional). Aceita image/jpeg, image/png ou application/pdf, até 10MB.',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Incidente registrado.', schema: INCIDENT_SCHEMA })
  @ApiResponse({
    status: 400,
    description: 'Corpo inválido, erro de validação da procedure, ou arquivo de tipo/tamanho inválido.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: '`vehicleId` ou `driverId` não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({
    status: 409,
    description: 'Motorista inativo, ou `tripId` informado com motorista/status de viagem incompatíveis.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  criar(
    @Body() dados: CreateIncidentDto,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    let photoUrl: string | null = null;
    let photoKey: string | null = null;

    // A foto é opcional: nem todo incidente tem uma.
    if (arquivo) {
      const porta = this.servicoDeConfiguracao.get('app.port', { infer: true });
      photoUrl = `http://localhost:${porta}/uploads/incidents/${arquivo.filename}`;
      photoKey = arquivo.filename;
    }

    return this.servicoIncidents.criar(dados, photoUrl, photoKey, usuario.userId);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'FLEET_MANAGER')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atualiza o status de um incidente',
    description:
      'Transição simples, sem procedure envolvida. Só anda para frente na ordem ' +
      '`REPORTED -> UNDER_INVESTIGATION -> RESOLVED`; pedir um status igual ou anterior ao ' +
      'atual resulta em 400 (não existe rota para "voltar" um incidente já resolvido). Acesso: ' +
      'ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `incidents`; escreve em `incidents`.',
    ...({
      'x-database-tables': { read: ['incidents'], write: ['incidents'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do incidente (UUID).', format: 'uuid' })
  @ApiBody({ type: UpdateIncidentStatusDto })
  @ApiResponse({ status: 200, description: 'Status do incidente atualizado.', schema: INCIDENT_SCHEMA })
  @ApiResponse({
    status: 400,
    description: 'Corpo inválido, ou transição inválida (status igual ou anterior ao atual).',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Incidente não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  atualizarStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: UpdateIncidentStatusDto,
  ) {
    return this.servicoIncidents.atualizarStatus(id, dados);
  }

  @Delete(':id')
  @Roles('ADMIN', 'FLEET_MANAGER')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um incidente (soft delete)',
    description:
      'Marca `deletedAt` no incidente; a linha continua no banco e pode ser restaurada em ' +
      '`PATCH /incidents/:id/restore`. O arquivo físico da foto (se houver) não é apagado aqui — ' +
      'o incidente pode ser restaurado depois e a foto precisa continuar existindo. Acesso: ' +
      'ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `incidents`; escreve em `incidents`.',
    ...({
      'x-database-tables': { read: ['incidents'], write: ['incidents'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do incidente (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Incidente removido (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Incidente não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  async remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoIncidents.remover(id);
  }

  @Patch(':id/restore')
  @Roles('ADMIN', 'FLEET_MANAGER')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaura um incidente removido',
    description:
      'Limpa `deletedAt`, revertendo o soft delete. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `incidents`; escreve em `incidents`.',
    ...({
      'x-database-tables': { read: ['incidents'], write: ['incidents'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do incidente (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Incidente restaurado.', schema: INCIDENT_SCHEMA })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Incidente não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  restaurar(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoIncidents.restaurar(id);
  }

  // Irreversível: apaga a linha de verdade do banco (e o arquivo físico, se houver).
  @Delete(':id/permanent')
  @Roles('ADMIN', 'FLEET_MANAGER')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um incidente permanentemente (hard delete)',
    description:
      'Apaga a linha de verdade do banco — irreversível, diferente do `DELETE /incidents/:id` ' +
      '(soft delete). Aqui sim o arquivo físico da foto (se houver) é apagado do disco. Acesso: ' +
      'ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `incidents`; escreve (apaga) em `incidents`.',
    ...({
      'x-database-tables': { read: ['incidents'], write: ['incidents'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do incidente (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Incidente apagado definitivamente (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Incidente não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  async removerPermanentemente(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoIncidents.removerPermanentemente(id);
  }
}
