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
import { UpdateDriverDto } from './dto/update-driver.dto';

// Tira o nome de dentro de `user` e devolve como campo solto `fullName`,
// sem levar o resto de `users` (email, senha, roleId) para a resposta.
function formatarMotoristaComNome<T extends { user: { fullName: string } }>(
  motorista: T,
) {
  const { user, ...resto } = motorista;
  return { ...resto, fullName: user.fullName };
}

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
        include: { user: { select: { fullName: true } } },
      }),
      this.servicoPrisma.comSoftDelete.driver.count(),
    ]);

    return montarPaginacao(
      dados.map(formatarMotoristaComNome),
      total,
      paginacao.page,
      paginacao.pageSize,
    );
  }

  async buscarPorId(id: string) {
    const motorista = await this.servicoPrisma.comSoftDelete.driver.findUnique({
      where: { id },
      include: { user: { select: { fullName: true } } },
    });
    if (!motorista) {
      throw new NotFoundException('Driver not found');
    }
    return formatarMotoristaComNome(motorista);
  }

  // Só a validade da CNH muda; data vencida é recusada (mesma regra da criação).
  async atualizarParcial(id: string, dados: UpdateDriverDto) {
    await this.buscarPorId(id);

    const novaValidade = new Date(dados.licenseExpiry);
    if (novaValidade < new Date()) {
      throw new BadRequestException('licenseExpiry cannot be in the past');
    }

    return this.servicoPrisma.driver.update({
      where: { id },
      data: { licenseExpiry: novaValidade },
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
      this.servicoSoftDelete.listarRemovidos<{ id: string }>('driver', {
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
      }),
      this.servicoSoftDelete.contarRemovidos('driver'),
    ]);

    const dadosComNome = await this.adicionarNomeDoMotorista(dados);

    return montarPaginacao(
      dadosComNome,
      total,
      paginacao.page,
      paginacao.pageSize,
    );
  }

  // O serviço genérico de soft delete não sabe de `users`, então busca os
  // nomes numa segunda consulta específica de drivers (sem mexer nele).
  private async adicionarNomeDoMotorista<T extends { id: string }>(
    motoristas: T[],
  ): Promise<(T & { fullName: string | null })[]> {
    if (motoristas.length === 0) {
      return [];
    }

    const ids = motoristas.map((motorista) => motorista.id);
    const usuarios = await this.servicoPrisma.driver.findMany({
      where: { id: { in: ids } },
      select: { id: true, user: { select: { fullName: true } } },
    });
    const nomePorId = new Map(
      usuarios.map((usuario) => [usuario.id, usuario.user.fullName]),
    );

    return motoristas.map((motorista) => ({
      ...motorista,
      fullName: nomePorId.get(motorista.id) ?? null,
    }));
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
}
