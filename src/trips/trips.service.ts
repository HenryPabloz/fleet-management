import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { apagarFotoDoIncidente } from '../incidents/utils/apagar-foto-incidente.util';
import { PrismaService } from '../database/prisma.service';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { ViaCepService } from '../external/viacep/via-cep.service';
import { traduzirErroDeProcedure } from '../common/utils/mapeador-erros-procedure.util';
import {
  montarPaginacao,
  normalizarPaginacao,
  ResultadoPaginado,
} from '../common/utils/paginacao.util';
import { buscarDriverIdProprio } from '../common/utils/resolver-driver-proprio.util';
import { CreateTripDto } from './dto/create-trip.dto';
import { StartTripDto } from './dto/start-trip.dto';
import { EndTripDto } from './dto/end-trip.dto';

@Injectable()
export class TripsService {
  constructor(
    private servicoPrisma: PrismaService,
    private servicoSoftDelete: SoftDeleteService,
    private servicoViaCep: ViaCepService,
  ) {}

  // escopoDoUsuario: quem só tem TRIP_VIEW_OWN (não TRIP_VIEW_ALL) tem o
  // driverId da query IGNORADO e forçado para o próprio motorista — motorista
  // não escolhe ver viagem de outro. Sem Driver vinculado, devolve lista vazia.
  async listar(
    page?: number,
    pageSize?: number,
    status?: string,
    driverId?: string,
    vehicleId?: string,
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
    if (status) {
      where.status = status;
    }
    if (driverIdFiltro) {
      where.driverId = driverIdFiltro;
    }
    if (vehicleId) {
      where.vehicleId = vehicleId;
    }

    const [dados, total] = await Promise.all([
      this.servicoPrisma.comSoftDelete.trip.findMany({
        where,
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.servicoPrisma.comSoftDelete.trip.count({ where }),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async buscarPorId(id: string) {
    const viagem = await this.servicoPrisma.comSoftDelete.trip.findUnique({
      where: { id },
    });
    if (!viagem) {
      throw new NotFoundException('Trip not found');
    }
    return viagem;
  }

  // create_trip valida tudo (motorista, CNH, veículo, quilometragem) e já
  // insere a viagem PLANNED reservando o veículo (IN_USE).
  async criar(dados: CreateTripDto, idDoUsuario: string) {
    let idDaViagemCriada = '';

    // startLocation/endLocation chegam aqui como CEP (já validados pelo
    // @IsValidCep() do DTO). Resolvemos os dois na API do ViaCEP e gravamos o
    // endereço, não o CEP cru.
    const [enderecoInicio, enderecoFim] = await Promise.all([
      this.servicoViaCep.buscarPorCep(dados.startLocation),
      this.servicoViaCep.buscarPorCep(dados.endLocation),
    ]);

    try {
      await this.servicoPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${idDoUsuario}::text, true)`;

        const resultado = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          CALL create_trip(${dados.driverId}::uuid, ${dados.vehicleId}::uuid, ${dados.startKm}, ${enderecoInicio.fullAddress}, ${enderecoFim.fullAddress}, ${idDoUsuario}::uuid, NULL, NULL)
        `;
        idDaViagemCriada = resultado[0].id;
      });
    } catch (erro) {
      traduzirErroDeProcedure(erro);
    }

    return this.buscarPorId(idDaViagemCriada);
  }

  // start_trip exige o vehicleId da viagem; buscamos aqui em vez de pedir no
  // DTO, para o cliente não ter que repassar um dado que a viagem já tem.
  async iniciar(id: string, dados: StartTripDto, idDoUsuario: string) {
    const viagem = await this.buscarPorId(id);

    try {
      await this.servicoPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${idDoUsuario}::text, true)`;

        await tx.$queryRaw`
          CALL start_trip(${id}::uuid, ${viagem.vehicleId}::uuid, ${dados.currentMileage}, NULL, NULL, NULL)
        `;
      });
    } catch (erro) {
      traduzirErroDeProcedure(erro);
    }

    return this.buscarPorId(id);
  }

  async finalizar(id: string, dados: EndTripDto, idDoUsuario: string) {
    await this.buscarPorId(id);

    try {
      await this.servicoPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${idDoUsuario}::text, true)`;

        await tx.$queryRaw`
          CALL end_trip(${id}::uuid, ${dados.endMileage}, ${dados.endLocation}, NULL, NULL, NULL, NULL, NULL, NULL)
        `;
      });
    } catch (erro) {
      traduzirErroDeProcedure(erro);
    }

    return this.buscarPorId(id);
  }

  async cancelar(id: string, idDoUsuario: string) {
    await this.buscarPorId(id);

    try {
      await this.servicoPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${idDoUsuario}::text, true)`;

        await tx.$queryRaw`CALL cancel_trip(${id}::uuid, NULL, NULL)`;
      });
    } catch (erro) {
      traduzirErroDeProcedure(erro);
    }

    return this.buscarPorId(id);
  }

  // Decisão do coordenador: nunca soft-delete uma viagem PLANNED/IN_PROGRESS
  // direto. Isso deixaria o veículo preso em IN_USE sem viagem ativa de
  // verdade. Só estados terminais (COMPLETED/CANCELLED) podem ser removidos.
  async remover(id: string): Promise<void> {
    const viagem = await this.buscarPorId(id);

    if (viagem.status === 'PLANNED' || viagem.status === 'IN_PROGRESS') {
      throw new ConflictException(
        'Cannot delete an active trip. Cancel it first via PATCH /trips/:id/cancel.',
      );
    }

    await this.servicoSoftDelete.removerLogicamente('trip', id);
  }

  async restaurar(id: string) {
    const viagem = await this.servicoPrisma.trip.findUnique({ where: { id } });
    if (!viagem) {
      throw new NotFoundException('Trip not found');
    }

    return this.servicoSoftDelete.restaurar('trip', id);
  }

  async listarRemovidos(
    page?: number,
    pageSize?: number,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const [dados, total] = await Promise.all([
      this.servicoSoftDelete.listarRemovidos('trip', {
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
      }),
      this.servicoSoftDelete.contarRemovidos('trip'),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  // Só apaga se todos os incidentes da viagem estiverem RESOLVED; eles são apagados junto
  // (sem órfãos), na mesma transação. As fotos só saem do disco depois do commit.
  async removerPermanentemente(id: string, idDoUsuario: string): Promise<void> {
    const viagem = await this.servicoPrisma.trip.findUnique({ where: { id } });
    if (!viagem) {
      throw new NotFoundException('Trip not found');
    }

    let fotosParaApagar: (string | null)[] = [];

    try {
      await this.servicoPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${idDoUsuario}::text, true)`;

        const incidentes = await tx.incident.findMany({ where: { tripId: id } });
        const temNaoResolvido = incidentes.some(
          (incidente) => incidente.status !== 'RESOLVED',
        );
        if (temNaoResolvido) {
          throw new ConflictException(
            'Cannot permanently delete a trip with unresolved incidents. Resolve them first.',
          );
        }

        await tx.incident.deleteMany({ where: { tripId: id } });
        await tx.trip.delete({ where: { id } });

        fotosParaApagar = incidentes.map((incidente) => incidente.photoKey);
      });
    } catch (erro) {
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot permanently delete: the trip is referenced by other records.',
        );
      }
      throw erro;
    }

    for (const chaveDaFoto of fotosParaApagar) {
      await apagarFotoDoIncidente(chaveDaFoto);
    }
  }
}
