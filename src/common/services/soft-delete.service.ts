import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// Nomes de model como o Prisma Client expõe (minúsculo), só os que têm deletedAt.
export type NomeDeModeloComSoftDelete =
  | 'user'
  | 'driver'
  | 'vehicle'
  | 'trip'
  | 'refueling'
  | 'maintenance'
  | 'incident';

// Serviço genérico de soft delete: reutilizado por qualquer resource que
// precise remover/restaurar sem apagar a linha de verdade do banco.
@Injectable()
export class SoftDeleteService {
  constructor(private servicoPrisma: PrismaService) {}

  // any: acesso dinâmico "prisma[nomeDoModelo]" não tem como ser tipado sem repetir
  // este serviço inteiro para cada model; os métodos públicos abaixo continuam tipados.
  private modelo(nome: NomeDeModeloComSoftDelete): any {
    return (this.servicoPrisma as any)[nome];
  }

  async removerLogicamente<T = unknown>(
    nome: NomeDeModeloComSoftDelete,
    id: string,
  ): Promise<T> {
    return this.modelo(nome).update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restaurar<T = unknown>(
    nome: NomeDeModeloComSoftDelete,
    id: string,
    selecao?: Record<string, boolean>,
  ): Promise<T> {
    const parametros: Record<string, unknown> = {
      where: { id },
      data: { deletedAt: null },
    };
    // Select opcional: quem chama pode pedir uma seleção segura (sem password/apiKey, por exemplo).
    if (selecao) {
      parametros.select = selecao;
    }
    return this.modelo(nome).update(parametros);
  }

  // Irreversível: apaga a linha do banco de verdade (DELETE), não é soft delete.
  async removerPermanentemente<T = unknown>(
    nome: NomeDeModeloComSoftDelete,
    id: string,
  ): Promise<T> {
    return this.modelo(nome).delete({ where: { id } });
  }

  async listarRemovidos<T = unknown>(
    nome: NomeDeModeloComSoftDelete,
    parametros: { skip?: number; take?: number } = {},
  ): Promise<T[]> {
    return this.modelo(nome).findMany({
      where: { deletedAt: { not: null } },
      skip: parametros.skip,
      take: parametros.take,
      orderBy: { deletedAt: 'desc' },
    });
  }

  async contarRemovidos(nome: NomeDeModeloComSoftDelete): Promise<number> {
    return this.modelo(nome).count({ where: { deletedAt: { not: null } } });
  }

  async estaRemovido(
    nome: NomeDeModeloComSoftDelete,
    id: string,
  ): Promise<boolean> {
    const registro = await this.modelo(nome).findUnique({ where: { id } });
    if (!registro) {
      return false;
    }
    return registro.deletedAt !== null;
  }
}
