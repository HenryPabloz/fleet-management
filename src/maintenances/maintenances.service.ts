import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { MaintenanceStatus } from '../generated/prisma/client';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import {
  montarPaginacao,
  normalizarPaginacao,
  ResultadoPaginado,
} from '../common/utils/paginacao.util';
import { traduzirErroDeEscritaVeiculo } from '../vehicles/vehicles.service';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';

// Manutenções que ainda contam como "o veículo está em manutenção".
const STATUS_ATIVOS: MaintenanceStatus[] = ['SCHEDULED', 'IN_PROGRESS'];

const MENSAGEM_COMPLETED_ANTES_DE_SCHEDULED =
  'completedDate cannot be before scheduledDate. Provide an explicit completedDate on or after the scheduled date, or wait until then.';

// Rede de segurança: se a validação em código deixar passar algo e o banco
// recusar pela CHECK constraint, traduz para 400 em vez de estourar 500 cru.
function traduzirErroDeEscritaManutencao(erro: unknown): never {
  if (erro instanceof Error && erro.message.includes('ck_maintenances_')) {
    throw new BadRequestException(MENSAGEM_COMPLETED_ANTES_DE_SCHEDULED);
  }
  throw erro;
}

@Injectable()
export class MaintenancesService {
  constructor(
    private servicoPrisma: PrismaService,
    private servicoSoftDelete: SoftDeleteService,
  ) {}

  async listar(
    page?: number,
    pageSize?: number,
    status?: string,
    vehicleId?: string,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }
    if (vehicleId) {
      where.vehicleId = vehicleId;
    }

    const [dados, total] = await Promise.all([
      this.servicoPrisma.comSoftDelete.maintenance.findMany({
        where,
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.servicoPrisma.comSoftDelete.maintenance.count({ where }),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async buscarPorId(id: string) {
    const manutencao =
      await this.servicoPrisma.comSoftDelete.maintenance.findUnique({
        where: { id },
      });
    if (!manutencao) {
      throw new NotFoundException('Maintenance not found');
    }
    return manutencao;
  }

  async criar(dados: CreateMaintenanceDto, registeredBy: string) {
    const veiculo = await this.servicoPrisma.comSoftDelete.vehicle.findUnique(
      { where: { id: dados.vehicleId } },
    );
    if (!veiculo) {
      throw new BadRequestException('vehicleId does not exist');
    }

    let status: MaintenanceStatus = 'SCHEDULED';
    if (dados.status) {
      status = dados.status;
    }

    const manutencao = await this.servicoPrisma.maintenance.create({
      data: {
        vehicleId: dados.vehicleId,
        type: dados.type as Prisma.MaintenanceCreateInput['type'],
        status: status as Prisma.MaintenanceCreateInput['status'],
        scheduledDate: new Date(dados.scheduledDate),
        description: dados.description,
        cost: dados.cost,
        registeredBy,
      },
    });

    // Sem trigger de sincronia no banco: se a manutenção nasce ativa e o
    // veículo está disponível, marcamos o veículo como em manutenção aqui.
    // Se o veículo estiver IN_USE (viagem ativa) ou OUT_OF_SERVICE, não
    // mexemos no status dele (agendar manutenção futura é razoável).
    if (STATUS_ATIVOS.includes(status) && veiculo.status === 'AVAILABLE') {
      try {
        await this.servicoPrisma.vehicle.update({
          where: { id: dados.vehicleId },
          data: { status: 'IN_MAINTENANCE' },
        });
      } catch (erro) {
        traduzirErroDeEscritaVeiculo(erro);
      }
    }

    return manutencao;
  }

  async atualizarParcial(id: string, dados: UpdateMaintenanceDto) {
    const manutencao = await this.buscarPorId(id);

    let completedDate: Date | undefined;
    if (dados.completedDate) {
      completedDate = new Date(dados.completedDate);
    }
    // Completou e não veio completedDate no corpo: preenche com agora.
    if (dados.status === 'COMPLETED' && !completedDate) {
      completedDate = new Date();
    }

    let scheduledDateFinal: Date;
    if (dados.scheduledDate) {
      scheduledDateFinal = new Date(dados.scheduledDate);
    } else {
      scheduledDateFinal = manutencao.scheduledDate;
    }
    // Valida antes de tentar o UPDATE: não depende de capturar erro do banco.
    if (completedDate && completedDate < scheduledDateFinal) {
      throw new BadRequestException(MENSAGEM_COMPLETED_ANTES_DE_SCHEDULED);
    }

    let atualizada;
    try {
      atualizada = await this.servicoPrisma.maintenance.update({
        where: { id },
        data: {
          type: dados.type as Prisma.MaintenanceUpdateInput['type'],
          status: dados.status as Prisma.MaintenanceUpdateInput['status'],
          scheduledDate: dados.scheduledDate
            ? new Date(dados.scheduledDate)
            : undefined,
          completedDate,
          description: dados.description,
          cost: dados.cost,
        },
      });
    } catch (erro) {
      traduzirErroDeEscritaManutencao(erro);
    }

    if (dados.status === 'COMPLETED' && manutencao.status !== 'COMPLETED') {
      await this.sincronizarVeiculoAposConclusao(manutencao.vehicleId, id);
    }

    return atualizada;
  }

  // Manutenção concluída: a quilometragem "zera" o contador de manutenção do
  // veículo, e o veículo volta a ficar disponível se não houver outra
  // manutenção ativa e ele ainda estiver marcado como em manutenção (não
  // mexemos nele se, por algum motivo, já estiver IN_USE ou OUT_OF_SERVICE).
  private async sincronizarVeiculoAposConclusao(
    vehicleId: string,
    idDaManutencaoConcluida: string,
  ): Promise<void> {
    const veiculo = await this.servicoPrisma.comSoftDelete.vehicle.findUnique(
      { where: { id: vehicleId } },
    );
    if (!veiculo) {
      return;
    }

    try {
      await this.servicoPrisma.vehicle.update({
        where: { id: vehicleId },
        data: { lastMaintenanceKm: veiculo.currentMileage },
      });

      await this.liberarVeiculoSeSemManutencaoAtiva(
        vehicleId,
        idDaManutencaoConcluida,
      );
    } catch (erro) {
      traduzirErroDeEscritaVeiculo(erro);
    }
  }

  // Compartilhado entre a conclusão (status COMPLETED) e a remoção (soft
  // delete) de uma manutenção: nos dois casos, se não sobrar nenhuma outra
  // manutenção ativa pro veículo e ele ainda estiver IN_MAINTENANCE, volta pra
  // AVAILABLE. idDaManutencaoParaExcluir é a manutenção que acabou de sair do
  // estado ativo (concluída ou removida) — não conta como "outra ativa".
  private async liberarVeiculoSeSemManutencaoAtiva(
    vehicleId: string,
    idDaManutencaoParaExcluir: string,
  ): Promise<void> {
    const veiculo = await this.servicoPrisma.comSoftDelete.vehicle.findUnique(
      { where: { id: vehicleId } },
    );
    if (!veiculo || veiculo.status !== 'IN_MAINTENANCE') {
      return;
    }

    const outraManutencaoAtiva =
      await this.servicoPrisma.comSoftDelete.maintenance.findFirst({
        where: {
          vehicleId,
          status: { in: STATUS_ATIVOS },
          id: { not: idDaManutencaoParaExcluir },
        },
      });

    if (!outraManutencaoAtiva) {
      await this.servicoPrisma.vehicle.update({
        where: { id: vehicleId },
        data: { status: 'AVAILABLE' },
      });
    }
  }

  async remover(id: string): Promise<void> {
    const manutencao = await this.buscarPorId(id);

    await this.servicoSoftDelete.removerLogicamente('maintenance', id);

    // Se a manutenção removida estava ativa (SCHEDULED/IN_PROGRESS) e era a
    // única do veículo, ele não pode ficar preso em IN_MAINTENANCE para
    // sempre — reverte pra AVAILABLE, igual à conclusão.
    if (STATUS_ATIVOS.includes(manutencao.status)) {
      try {
        await this.liberarVeiculoSeSemManutencaoAtiva(manutencao.vehicleId, id);
      } catch (erro) {
        traduzirErroDeEscritaVeiculo(erro);
      }
    }
  }

  async restaurar(id: string) {
    const manutencao = await this.servicoPrisma.maintenance.findUnique({
      where: { id },
    });
    if (!manutencao) {
      throw new NotFoundException('Maintenance not found');
    }

    return this.servicoSoftDelete.restaurar('maintenance', id);
  }

  async listarRemovidos(
    page?: number,
    pageSize?: number,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const [dados, total] = await Promise.all([
      this.servicoSoftDelete.listarRemovidos('maintenance', {
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
      }),
      this.servicoSoftDelete.contarRemovidos('maintenance'),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async removerPermanentemente(id: string): Promise<void> {
    const manutencao = await this.servicoPrisma.maintenance.findUnique({
      where: { id },
    });
    if (!manutencao) {
      throw new NotFoundException('Maintenance not found');
    }

    await this.servicoSoftDelete.removerPermanentemente('maintenance', id);
  }
}
