import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import {
  montarPaginacao,
  normalizarPaginacao,
  ResultadoPaginado,
} from '../common/utils/paginacao.util';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ReplaceVehicleDto } from './dto/replace-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

// Traduz erro de escrita em vehicles (trigger RAISE EXCEPTION ou CHECK do banco)
// para uma exceção HTTP. Exportada porque o MaintenancesService também escreve
// em vehicles (sincronia de status) e precisa do mesmo tratamento.
export function traduzirErroDeEscritaVeiculo(erro: unknown): never {
  if (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === 'P2002'
  ) {
    throw new ConflictException('Plate already registered');
  }

  if (erro instanceof Error) {
    const mensagem = erro.message;

    if (mensagem.includes('Vehicle has an active trip: end or cancel it first')) {
      throw new ConflictException(
        'Vehicle has an active trip: end or cancel it first',
      );
    }
    if (mensagem.includes('IN_USE is set only by trips')) {
      throw new ConflictException('IN_USE is set only by trips');
    }
    if (mensagem.includes('Mileage cannot decrease')) {
      throw new ConflictException('Mileage cannot decrease');
    }
    if (mensagem.includes('ck_vehicles_')) {
      throw new BadRequestException('Invalid vehicle data');
    }
  }

  throw erro;
}

@Injectable()
export class VehiclesService {
  constructor(
    private servicoPrisma: PrismaService,
    private servicoSoftDelete: SoftDeleteService,
  ) {}

  async listar(
    page?: number,
    pageSize?: number,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const [dados, total] = await Promise.all([
      this.servicoPrisma.comSoftDelete.vehicle.findMany({
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.servicoPrisma.comSoftDelete.vehicle.count(),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async buscarPorId(id: string) {
    const veiculo = await this.servicoPrisma.comSoftDelete.vehicle.findUnique({
      where: { id },
    });
    if (!veiculo) {
      throw new NotFoundException('Vehicle not found');
    }
    return veiculo;
  }

  async criar(dados: CreateVehicleDto) {
    const placaJaExiste = await this.servicoPrisma.vehicle.findUnique({
      where: { plate: dados.plate },
    });
    if (placaJaExiste) {
      throw new ConflictException('Plate already registered');
    }

    let status = 'AVAILABLE';
    if (dados.status) {
      status = dados.status;
    }
    let currentMileage = 0;
    if (dados.currentMileage !== undefined) {
      currentMileage = dados.currentMileage;
    }
    let lastMaintenanceKm = 0;
    if (dados.lastMaintenanceKm !== undefined) {
      lastMaintenanceKm = dados.lastMaintenanceKm;
    }

    try {
      return await this.servicoPrisma.vehicle.create({
        data: {
          plate: dados.plate,
          model: dados.model,
          year: dados.year,
          status: status as Prisma.VehicleCreateInput['status'],
          currentMileage,
          lastMaintenanceKm,
        },
      });
    } catch (erro) {
      traduzirErroDeEscritaVeiculo(erro);
    }
  }

  async atualizarParcial(id: string, dados: UpdateVehicleDto) {
    await this.buscarPorId(id);

    try {
      return await this.servicoPrisma.vehicle.update({
        where: { id },
        data: {
          model: dados.model,
          year: dados.year,
          status: dados.status as Prisma.VehicleUpdateInput['status'],
          currentMileage: dados.currentMileage,
          lastMaintenanceKm: dados.lastMaintenanceKm,
        },
      });
    } catch (erro) {
      traduzirErroDeEscritaVeiculo(erro);
    }
  }

  async substituir(id: string, dados: ReplaceVehicleDto) {
    await this.buscarPorId(id);

    try {
      return await this.servicoPrisma.vehicle.update({
        where: { id },
        data: {
          model: dados.model,
          year: dados.year,
          status: dados.status as Prisma.VehicleUpdateInput['status'],
          currentMileage: dados.currentMileage,
          lastMaintenanceKm: dados.lastMaintenanceKm,
        },
      });
    } catch (erro) {
      traduzirErroDeEscritaVeiculo(erro);
    }
  }

  async remover(id: string): Promise<void> {
    const veiculo = await this.buscarPorId(id);

    // Veículo com viagem ativa não pode "sumir" do sistema.
    if (veiculo.status === 'IN_USE') {
      throw new ConflictException(
        'Cannot delete a vehicle that is currently in use.',
      );
    }

    await this.servicoSoftDelete.removerLogicamente('vehicle', id);
  }

  async restaurar(id: string) {
    const veiculo = await this.servicoPrisma.vehicle.findUnique({
      where: { id },
    });
    if (!veiculo) {
      throw new NotFoundException('Vehicle not found');
    }

    return this.servicoSoftDelete.restaurar('vehicle', id);
  }

  async listarRemovidos(
    page?: number,
    pageSize?: number,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const [dados, total] = await Promise.all([
      this.servicoSoftDelete.listarRemovidos('vehicle', {
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
      }),
      this.servicoSoftDelete.contarRemovidos('vehicle'),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async removerPermanentemente(id: string): Promise<void> {
    const veiculo = await this.servicoPrisma.vehicle.findUnique({
      where: { id },
    });
    if (!veiculo) {
      throw new NotFoundException('Vehicle not found');
    }

    // Sem filtro de soft delete: a FK não tem ON DELETE CASCADE, mas preferimos
    // uma mensagem clara em vez de deixar estourar erro de FK (23503).
    const [temViagem, temAbastecimento, temManutencao, temIncidente] =
      await Promise.all([
        this.servicoPrisma.trip.findFirst({ where: { vehicleId: id } }),
        this.servicoPrisma.refueling.findFirst({ where: { vehicleId: id } }),
        this.servicoPrisma.maintenance.findFirst({ where: { vehicleId: id } }),
        this.servicoPrisma.incident.findFirst({ where: { vehicleId: id } }),
      ]);
    if (temViagem || temAbastecimento || temManutencao || temIncidente) {
      throw new ConflictException(
        'Cannot permanently delete a vehicle with associated trips, refuelings, maintenances or incidents.',
      );
    }

    await this.servicoSoftDelete.removerPermanentemente('vehicle', id);
  }
}
