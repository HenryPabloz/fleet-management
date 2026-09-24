import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import {
  montarPaginacao,
  normalizarPaginacao,
  ResultadoPaginado,
} from '../common/utils/paginacao.util';
import { ReplaceDriverDto } from './dto/replace-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

@Injectable()
export class DriversService {
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
      // comSoftDelete: a extension já injeta deletedAt: null, então removidos não aparecem.
      this.servicoPrisma.comSoftDelete.driver.findMany({
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.servicoPrisma.comSoftDelete.driver.count(),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async buscarPorId(id: string) {
    const motorista = await this.servicoPrisma.comSoftDelete.driver.findUnique({
      where: { id },
    });
    if (!motorista) {
      throw new NotFoundException('Driver not found');
    }
    return motorista;
  }

  async atualizarParcial(id: string, dados: UpdateDriverDto) {
    await this.buscarPorId(id);

    if (dados.licenseNumber) {
      await this.validarLicenseNumberLivre(dados.licenseNumber, id);
    }

    let licenseExpiry: Date | undefined;
    if (dados.licenseExpiry) {
      licenseExpiry = new Date(dados.licenseExpiry);
    }

    return this.servicoPrisma.driver.update({
      where: { id },
      data: {
        licenseNumber: dados.licenseNumber,
        licenseExpiry,
        isActive: dados.isActive,
      },
    });
  }

  async substituir(id: string, dados: ReplaceDriverDto) {
    await this.buscarPorId(id);
    await this.validarLicenseNumberLivre(dados.licenseNumber, id);

    return this.servicoPrisma.driver.update({
      where: { id },
      data: {
        licenseNumber: dados.licenseNumber,
        licenseExpiry: new Date(dados.licenseExpiry),
        isActive: dados.isActive,
      },
    });
  }

  async remover(id: string): Promise<void> {
    await this.buscarPorId(id);
    await this.servicoSoftDelete.removerLogicamente('driver', id);
  }

  async restaurar(id: string) {
    const motorista = await this.servicoPrisma.driver.findUnique({
      where: { id },
    });
    if (!motorista) {
      throw new NotFoundException('Driver not found');
    }

    return this.servicoSoftDelete.restaurar('driver', id);
  }

  async listarRemovidos(
    page?: number,
    pageSize?: number,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const [dados, total] = await Promise.all([
      this.servicoSoftDelete.listarRemovidos('driver', {
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
      }),
      this.servicoSoftDelete.contarRemovidos('driver'),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async removerPermanentemente(id: string): Promise<void> {
    const motorista = await this.servicoPrisma.driver.findUnique({
      where: { id },
    });
    if (!motorista) {
      throw new NotFoundException('Driver not found');
    }

    // Conta também os soft-deletados, pois a FK do banco os enxerga.
    const [temViagem, temAbastecimento, temIncidente] = await Promise.all([
      this.servicoPrisma.trip.findFirst({ where: { driverId: id } }),
      this.servicoPrisma.refueling.findFirst({ where: { driverId: id } }),
      this.servicoPrisma.incident.findFirst({ where: { driverId: id } }),
    ]);
    if (temViagem || temAbastecimento || temIncidente) {
      throw new ConflictException(
        'Cannot permanently delete a driver with associated trips, refuelings or incidents.',
      );
    }

    await this.servicoSoftDelete.removerPermanentemente('driver', id);
  }

  private async validarLicenseNumberLivre(
    licenseNumber: string,
    idAtual: string,
  ): Promise<void> {
    const existente = await this.servicoPrisma.driver.findUnique({
      where: { licenseNumber },
    });
    if (existente && existente.id !== idAtual) {
      throw new ConflictException('License number already registered');
    }
  }
}
