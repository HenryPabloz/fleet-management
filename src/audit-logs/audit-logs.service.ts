import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  montarPaginacao,
  normalizarPaginacao,
  ResultadoPaginado,
} from '../common/utils/paginacao.util';

@Injectable()
export class AuditLogsService {
  constructor(private servicoPrisma: PrismaService) {}

  // audit_logs é append-only (sem deletedAt, trigger do banco bloqueia
  // UPDATE/DELETE) — não usa comSoftDelete, é leitura direta da tabela.
  async listar(
    page?: number,
    pageSize?: number,
    entityType?: string,
    entityId?: string,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const where: Record<string, unknown> = {};
    if (entityType) {
      where.entityType = entityType;
    }
    if (entityId) {
      where.entityId = entityId;
    }

    const [dados, total] = await Promise.all([
      this.servicoPrisma.auditLog.findMany({
        where,
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.servicoPrisma.auditLog.count({ where }),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }
}
