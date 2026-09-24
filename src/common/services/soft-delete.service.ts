import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
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

  // Só User e Driver têm coluna isActive; nos outros models soft-delete não mexe nela.
  private readonly MODELOS_COM_IS_ACTIVE: NomeDeModeloComSoftDelete[] = [
    'user',
    'driver',
  ];

  private temColunaIsActive(nome: NomeDeModeloComSoftDelete): boolean {
    return this.MODELOS_COM_IS_ACTIVE.includes(nome);
  }

  async removerLogicamente<T = unknown>(
    nome: NomeDeModeloComSoftDelete,
    id: string,
  ): Promise<T> {
    const dados: Record<string, unknown> = { deletedAt: new Date() };
    // Remover logicamente também revoga acesso: isActive vai junto para false.
    if (this.temColunaIsActive(nome)) {
      dados.isActive = false;
    }
    return this.modelo(nome).update({
      where: { id },
      data: dados,
    });
  }

  async restaurar<T = unknown>(
    nome: NomeDeModeloComSoftDelete,
    id: string,
    selecao?: Record<string, boolean>,
  ): Promise<T> {
    const dados: Record<string, unknown> = { deletedAt: null };
    // Restaurar desfaz o que o soft delete fez: isActive volta para true.
    if (this.temColunaIsActive(nome)) {
      dados.isActive = true;
    }
    const parametros: Record<string, unknown> = {
      where: { id },
      data: dados,
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
    try {
      return await this.modelo(nome).delete({ where: { id } });
    } catch (erro) {
      // Rede de segurança: se o banco recusar por FK, devolve 409 em vez de 500.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot permanently delete: the record is referenced by other records.',
        );
      }
      throw erro;
    }
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
