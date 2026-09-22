import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// Status possíveis de uma trip, na ordem que aparecem na resposta de driver/:id/trips.
const STATUS_DE_TRIP = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

@Injectable()
export class AnalyticsService {
  constructor(private servicoPrisma: PrismaService) {}

  // Consumo médio da frota inteira: litros abastecidos / km rodados em viagens concluídas.
  // Os dois totais vêm de subqueries independentes (refuelings e trips não têm relação
  // 1-para-1, então somar depois de um JOIN entre as duas tabelas duplicaria valores).
  async consumoDeCombustivelDaFrota() {
    const linhas = await this.servicoPrisma.$queryRaw<
      Array<{ totalLiters: string; totalKm: string }>
    >`
      SELECT
        COALESCE((SELECT SUM(liters_added) FROM refuelings WHERE deleted_at IS NULL), 0)::numeric AS "totalLiters",
        COALESCE(
          (SELECT SUM(end_km - start_km) FROM trips
            WHERE status = 'COMPLETED' AND deleted_at IS NULL AND end_km IS NOT NULL),
          0
        )::bigint AS "totalKm"
    `;

    const totalLiters = Number(linhas[0].totalLiters);
    const totalKm = Number(linhas[0].totalKm);

    let averageLitersPerKm = 0;
    if (totalKm > 0) {
      averageLitersPerKm = totalLiters / totalKm;
    }

    return { averageLitersPerKm, totalLiters, totalKm };
  }

  // Km rodados por dia, nos últimos "dias" dias, agrupando pelo dia de término da viagem.
  async distanciaDiaria(dias: number) {
    const linhas = await this.servicoPrisma.$queryRaw<
      Array<{ date: Date; totalKm: string }>
    >`
      SELECT
        DATE(end_time) AS "date",
        COALESCE(SUM(end_km - start_km), 0)::bigint AS "totalKm"
      FROM trips
      WHERE status = 'COMPLETED'
        AND deleted_at IS NULL
        AND end_km IS NOT NULL
        AND end_time >= NOW() - (INTERVAL '1 day' * ${dias})
      GROUP BY DATE(end_time)
      ORDER BY DATE(end_time)
    `;

    return linhas.map((linha) => ({
      // DATE() do Postgres já vem como um Date à meia-noite UTC; formatamos como
      // "AAAA-MM-DD" para o retorno não carregar hora/fuso que não faz sentido aqui.
      date: linha.date.toISOString().slice(0, 10),
      totalKm: Number(linha.totalKm),
    }));
  }

  // Eficiência de um veículo específico: confirma que existe (404 se não), depois agrega.
  async eficienciaDoVeiculo(vehicleId: string) {
    const veiculo = await this.servicoPrisma.comSoftDelete.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!veiculo) {
      throw new NotFoundException('Vehicle not found');
    }

    const [linhasDeKm, somaDeAbastecimentos, quantidadeDeViagens, quantidadeDeIncidentes] =
      await Promise.all([
        this.servicoPrisma.$queryRaw<Array<{ totalKm: string }>>`
          SELECT COALESCE(SUM(end_km - start_km), 0)::bigint AS "totalKm"
          FROM trips
          WHERE fk_vehicle_id = ${vehicleId}::uuid
            AND status = 'COMPLETED'
            AND deleted_at IS NULL
            AND end_km IS NOT NULL
        `,
        this.servicoPrisma.refueling.aggregate({
          where: { vehicleId, deletedAt: null },
          _sum: { litersAdded: true, totalCost: true },
        }),
        this.servicoPrisma.comSoftDelete.trip.count({ where: { vehicleId } }),
        this.servicoPrisma.comSoftDelete.incident.count({ where: { vehicleId } }),
      ]);

    const totalKm = Number(linhasDeKm[0].totalKm);
    const totalLiters = Number(somaDeAbastecimentos._sum.litersAdded ?? 0);
    const totalFuelCost = Number(somaDeAbastecimentos._sum.totalCost ?? 0);

    let averageLitersPerKm = 0;
    if (totalKm > 0) {
      averageLitersPerKm = totalLiters / totalKm;
    }

    return {
      vehicleId,
      totalKm,
      totalLiters,
      totalFuelCost,
      averageLitersPerKm,
      tripsCount: quantidadeDeViagens,
      incidentsCount: quantidadeDeIncidentes,
    };
  }

  // Estatísticas de viagens de um motorista: confirma que existe (404 se não), depois agrega.
  async estatisticasDeViagensDoMotorista(driverId: string) {
    const motorista = await this.servicoPrisma.comSoftDelete.driver.findUnique({
      where: { id: driverId },
    });
    if (!motorista) {
      throw new NotFoundException('Driver not found');
    }

    const [contagemPorStatus, linhasDeKm, quantidadeDeIncidentes] = await Promise.all([
      // groupBy/aggregate não passam pela extension de soft delete: filtramos deletedAt na mão.
      this.servicoPrisma.trip.groupBy({
        by: ['status'],
        where: { driverId, deletedAt: null },
        _count: { _all: true },
      }),
      this.servicoPrisma.$queryRaw<Array<{ totalKm: string }>>`
        SELECT COALESCE(SUM(end_km - start_km), 0)::bigint AS "totalKm"
        FROM trips
        WHERE fk_driver_id = ${driverId}::uuid
          AND status = 'COMPLETED'
          AND deleted_at IS NULL
          AND end_km IS NOT NULL
      `,
      this.servicoPrisma.comSoftDelete.incident.count({ where: { driverId } }),
    ]);

    // Começa tudo zerado para as 4 status aparecerem mesmo sem nenhuma viagem naquele status.
    const tripsByStatus: Record<(typeof STATUS_DE_TRIP)[number], number> = {
      PLANNED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    for (const linha of contagemPorStatus) {
      tripsByStatus[linha.status] = linha._count._all;
    }

    return {
      driverId,
      tripsByStatus,
      totalKmCompleted: Number(linhasDeKm[0].totalKm),
      incidentsCount: quantidadeDeIncidentes,
    };
  }

  // Incidentes agrupados por severidade, com filtro opcional por status.
  async incidentesPorSeveridade(status?: string) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (status) {
      where.status = status;
    }

    const grupos = await this.servicoPrisma.incident.groupBy({
      by: ['severity'],
      where,
      _count: { _all: true },
    });

    return grupos.map((grupo) => ({
      severity: grupo.severity,
      count: grupo._count._all,
    }));
  }
}
