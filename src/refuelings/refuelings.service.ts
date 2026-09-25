import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { traduzirErroDeProcedure } from '../common/utils/mapeador-erros-procedure.util';
import {
  montarPaginacao,
  normalizarPaginacao,
  ResultadoPaginado,
} from '../common/utils/paginacao.util';
import { buscarDriverIdProprio, garantirDriverIdProprio } from '../common/utils/resolver-driver-proprio.util';
import { CreateRefuelingDto } from './dto/create-refueling.dto';

@Injectable()
export class RefuelingsService {
  constructor(
    private servicoPrisma: PrismaService,
    private servicoSoftDelete: SoftDeleteService,
  ) {}

  // escopoDoUsuario: quem só tem REFUELING_VIEW_OWN (não REFUELING_VIEW_ALL)
  // tem o driverId da query IGNORADO e forçado para o próprio motorista.
  // Sem Driver vinculado, devolve lista vazia.
  async listar(
    page?: number,
    pageSize?: number,
    vehicleId?: string,
    driverId?: string,
    escopoDoUsuario?: { userId: string; temPermissaoViewAll: boolean },
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    let driverIdFiltro = driverId;
    if (escopoDoUsuario && !escopoDoUsuario.temPermissaoViewAll) {
      const driverIdProprio = await buscarDriverIdProprio(
        this.servicoPrisma,
        escopoDoUsuario.userId,
      );
      if (!driverIdProprio) {
        return montarPaginacao([], 0, paginacao.page, paginacao.pageSize);
      }
      driverIdFiltro = driverIdProprio;
    }

    const where: Record<string, unknown> = {};
    if (vehicleId) {
      where.vehicleId = vehicleId;
    }
    if (driverIdFiltro) {
      where.driverId = driverIdFiltro;
    }

    const [dados, total] = await Promise.all([
      this.servicoPrisma.comSoftDelete.refueling.findMany({
        where,
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.servicoPrisma.comSoftDelete.refueling.count({ where }),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  // Com escopo e sem REFUELING_VIEW_ALL, só o do próprio motorista (senão 404,
  // igual a "não existe"). Sem escopo (uso interno) devolve qualquer um.
  async buscarPorId(
    id: string,
    escopoDoUsuario?: { userId: string; temPermissaoViewAll: boolean },
  ) {
    const abastecimento =
      await this.servicoPrisma.comSoftDelete.refueling.findUnique({
        where: { id },
      });
    if (!abastecimento) {
      throw new NotFoundException('Refueling not found');
    }
    if (escopoDoUsuario && !escopoDoUsuario.temPermissaoViewAll) {
      const driverIdProprio = await buscarDriverIdProprio(
        this.servicoPrisma,
        escopoDoUsuario.userId,
      );
      if (!driverIdProprio || abastecimento.driverId !== driverIdProprio) {
        throw new NotFoundException('Refueling not found');
      }
    }
    return abastecimento;
  }

  // register_refueling calcula o total_cost e grava o hodômetro atual do veículo
  // em mileage (foto); o abastecimento não altera o hodômetro.
  async criar(
    dados: CreateRefuelingDto,
    idDoUsuario: string,
    escopoDoUsuario?: { userId: string; temPermissaoViewAll: boolean },
  ) {
    let idDoAbastecimentoCriado = '';

    if (escopoDoUsuario) {
      await garantirDriverIdProprio(this.servicoPrisma, escopoDoUsuario, dados.driverId);
    }

    try {
      await this.servicoPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${idDoUsuario}::text, true)`;

        const resultado = await tx.$queryRaw<Array<{ id: string }>>`
          CALL register_refueling(${dados.vehicleId}::uuid, ${dados.driverId}::uuid, ${dados.litersAdded}::decimal, ${dados.costPerLiter}::decimal, ${dados.fuelType}, ${idDoUsuario}::uuid, NULL, NULL, NULL)
        `;
        idDoAbastecimentoCriado = resultado[0].id;
      });
    } catch (erro) {
      traduzirErroDeProcedure(erro);
    }

    return this.buscarPorId(idDoAbastecimentoCriado);
  }

  // Sem PATCH/PUT de edição livre: abastecimento é registro histórico gerado
  // por procedure. Corrigir um lançamento errado é apagar e recriar.
  async remover(id: string): Promise<void> {
    await this.buscarPorId(id);
    await this.servicoSoftDelete.removerLogicamente('refueling', id);
  }

  async restaurar(id: string) {
    const abastecimento = await this.servicoPrisma.refueling.findUnique({
      where: { id },
    });
    if (!abastecimento) {
      throw new NotFoundException('Refueling not found');
    }

    return this.servicoSoftDelete.restaurar('refueling', id);
  }

  async listarRemovidos(
    page?: number,
    pageSize?: number,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const [dados, total] = await Promise.all([
      this.servicoSoftDelete.listarRemovidos('refueling', {
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
      }),
      this.servicoSoftDelete.contarRemovidos('refueling'),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async removerPermanentemente(id: string): Promise<void> {
    const abastecimento = await this.servicoPrisma.refueling.findUnique({
      where: { id },
    });
    if (!abastecimento) {
      throw new NotFoundException('Refueling not found');
    }

    await this.servicoSoftDelete.removerPermanentemente('refueling', id);
  }
}
