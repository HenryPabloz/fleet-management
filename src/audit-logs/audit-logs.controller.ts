import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PaginacaoMetadataDto } from '../common/swagger/pagination-response.schema';
import { ProblemDetailsDto } from '../common/swagger/problem-details.schema';
import { ListAuditLogQueryDto } from './dto/list-audit-log-query.dto';
import { AuditLogsService } from './audit-logs.service';

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

// Schema de resposta de um registro de auditoria (não existe DTO de resposta
// neste resource; o service devolve a linha crua do Prisma).
const AUDIT_LOG_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    entityType: {
      type: 'string',
      enum: ['TRIP', 'REFUELING', 'INCIDENT', 'USER', 'DRIVER', 'VEHICLE', 'MAINTENANCE'],
      example: 'TRIP',
    },
    entityId: { type: 'string', format: 'uuid' },
    action: { type: 'string', enum: ['CREATE', 'UPDATE', 'DELETE'], example: 'UPDATE' },
    changedBy: { type: 'string', format: 'uuid', nullable: true, description: 'Autor da alteração. null = usuário removido.' },
    oldValues: { type: 'object', nullable: true, example: null },
    newValues: { type: 'object', nullable: true, example: { status: 'IN_PROGRESS' } },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

// Só leitura: audit_logs é append-only (trigger do banco bloqueia
// UPDATE/DELETE na tabela), então não existe rota de escrita aqui.
@ApiTags('audit-logs')
@ApiBearerAuth('jwt')
@ApiExtraModels(ProblemDetailsDto, PaginacaoMetadataDto)
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditLogsController {
  constructor(private servicoAuditLogs: AuditLogsService) {}

  @Get()
  @Permissions('AUDIT_VIEW')
  @ApiOperation({
    summary: 'Lista os registros de auditoria (paginado)',
    description:
      'Lista os registros de `audit_logs` (append-only, gerado pelas procedures do banco a cada ' +
      'CREATE/UPDATE/DELETE relevante), paginado, com filtros opcionais por `entityType` e ' +
      '`entityId`. Acesso: quem tiver a permissão `AUDIT_VIEW` (ADMIN tem por papel; outros ' +
      'papéis podem receber via delegação granular em `POST /users/:id/permissions`).\n\n' +
      '`x-database-tables`: lê `audit_logs`.',
    ...({ 'x-database-tables': { read: ['audit_logs'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiQuery({
    name: 'entityType',
    required: false,
    type: String,
    enum: ['TRIP', 'REFUELING', 'INCIDENT', 'USER', 'DRIVER', 'VEHICLE', 'MAINTENANCE'],
    description: 'Filtra pelo tipo de entidade auditada.',
    example: 'TRIP',
  })
  @ApiQuery({ name: 'entityId', required: false, type: String, format: 'uuid', description: 'Filtra pelo id da entidade.' })
  @ApiResponse({
    status: 200,
    description: 'Página de registros de auditoria.',
    schema: {
      allOf: [
        { properties: { data: { type: 'array', items: AUDIT_LOG_SCHEMA } } },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Filtro `entityId` fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Usuário autenticado não tem a permissão AUDIT_VIEW.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listar(@Query() query: ListAuditLogQueryDto) {
    return this.servicoAuditLogs.listar(
      query.page,
      query.pageSize,
      query.entityType,
      query.entityId,
    );
  }
}
