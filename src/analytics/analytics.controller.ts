import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ErroPadraoDto } from '../common/swagger/erro-padrao.schema';
import { AnalyticsService } from './analytics.service';
import { DailyDistanceQueryDto } from './dto/daily-distance-query.dto';
import { IncidentsSeverityQueryDto } from './dto/incidents-severity-query.dto';

const PADRAO_DE_DIAS = 30;

// Indicadores agregados de frota: só leitura, dado gerencial. Quem tiver
// ANALYTICS_VIEW acessa (ADMIN e FLEET_MANAGER por papel; motorista não
// enxerga números da frota inteira nem de outros motoristas por padrão).
@ApiTags('analytics')
@ApiBearerAuth('jwt')
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions('ANALYTICS_VIEW')
export class AnalyticsController {
  constructor(private servicoAnalytics: AnalyticsService) {}

  @Get('fleet/fuel-consumption')
  @ApiOperation({
    summary: 'Consumo médio de combustível da frota (litros por km rodado)',
    description:
      'Soma litros abastecidos e km rodados (viagens concluídas) de toda a frota, agregado no ' +
      'banco. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `refuelings`, `trips`.',
    ...({ 'x-database-tables': { read: ['refuelings', 'trips'] } } as Record<string, unknown>),
  })
  @ApiResponse({
    status: 200,
    description: 'Totais agregados da frota.',
    schema: {
      type: 'object',
      properties: {
        averageLitersPerKm: { type: 'number', example: 0.12 },
        totalLiters: { type: 'number', example: 4500.5 },
        totalKm: { type: 'number', example: 37500 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  consumoDeCombustivelDaFrota() {
    return this.servicoAnalytics.consumoDeCombustivelDaFrota();
  }

  @Get('fleet/daily-distance')
  @ApiOperation({
    summary: 'Km rodados por dia, nos últimos N dias',
    description:
      'Agrupa viagens concluídas por dia de término, somando os km rodados de cada dia. ' +
      'Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `trips`.',
    ...({ 'x-database-tables': { read: ['trips'] } } as Record<string, unknown>),
  })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Quantos dias para trás considerar. Padrão: 30.',
    example: 30,
  })
  @ApiResponse({
    status: 200,
    description: 'Km rodados por dia.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date', example: '2026-09-20' },
          totalKm: { type: 'number', example: 320 },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: '`days` fora do formato ou intervalo aceito.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  distanciaDiaria(@Query() query: DailyDistanceQueryDto) {
    const dias = query.days ?? PADRAO_DE_DIAS;
    return this.servicoAnalytics.distanciaDiaria(dias);
  }

  @Get('vehicle/:id/efficiency')
  @ApiOperation({
    summary: 'Eficiência de um veículo específico',
    description:
      'Km rodados, litros abastecidos, custo de combustível, média de litros/km, quantidade de ' +
      'viagens e de incidentes de um veículo. Sem nenhuma viagem, devolve zeros (200), não 404 — ' +
      'o 404 é só quando o veículo em si não existe. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `vehicles`, `trips`, `refuelings`, `incidents`.',
    ...({
      'x-database-tables': { read: ['vehicles', 'trips', 'refuelings', 'incidents'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do veículo (UUID).', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Indicadores do veículo.',
    schema: {
      type: 'object',
      properties: {
        vehicleId: { type: 'string', format: 'uuid' },
        totalKm: { type: 'number', example: 1200 },
        totalLiters: { type: 'number', example: 150.75 },
        totalFuelCost: { type: 'number', example: 890.4 },
        averageLitersPerKm: { type: 'number', example: 0.13 },
        tripsCount: { type: 'number', example: 8 },
        incidentsCount: { type: 'number', example: 1 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  eficienciaDoVeiculo(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoAnalytics.eficienciaDoVeiculo(id);
  }

  @Get('driver/:id/trips')
  @ApiOperation({
    summary: 'Estatísticas de viagens de um motorista',
    description:
      'Quantidade de viagens por status, km total rodado nas concluídas e quantidade de ' +
      'incidentes envolvendo o motorista. Sem nenhuma viagem, devolve zeros (200), não 404 — o ' +
      '404 é só quando o motorista em si não existe. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `drivers`, `trips`, `incidents`.',
    ...({
      'x-database-tables': { read: ['drivers', 'trips', 'incidents'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do motorista (UUID).', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Indicadores do motorista.',
    schema: {
      type: 'object',
      properties: {
        driverId: { type: 'string', format: 'uuid' },
        tripsByStatus: {
          type: 'object',
          properties: {
            PLANNED: { type: 'number', example: 1 },
            IN_PROGRESS: { type: 'number', example: 0 },
            COMPLETED: { type: 'number', example: 5 },
            CANCELLED: { type: 'number', example: 1 },
          },
        },
        totalKmCompleted: { type: 'number', example: 980 },
        incidentsCount: { type: 'number', example: 0 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Motorista não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  estatisticasDeViagensDoMotorista(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoAnalytics.estatisticasDeViagensDoMotorista(id);
  }

  @Get('incidents/severity')
  @ApiOperation({
    summary: 'Quantidade de incidentes agrupados por severidade',
    description:
      'Agrupa incidentes ativos por severidade, com filtro opcional por status. Acesso: ADMIN, ' +
      'FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `incidents`.',
    ...({ 'x-database-tables': { read: ['incidents'] } } as Record<string, unknown>),
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'],
    description: 'Filtra os incidentes por status antes de agrupar.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contagem de incidentes por severidade.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          count: { type: 'number', example: 3 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  incidentesPorSeveridade(@Query() query: IncidentsSeverityQueryDto) {
    return this.servicoAnalytics.incidentesPorSeveridade(query.status);
  }
}
