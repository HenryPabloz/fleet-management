import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import { traduzirErroDeProcedure } from '../common/utils/mapeador-erros-procedure.util';
import {
  montarPaginacao,
  normalizarPaginacao,
  ResultadoPaginado,
} from '../common/utils/paginacao.util';
import { buscarDriverIdProprio } from '../common/utils/resolver-driver-proprio.util';
import { apagarFotoDoIncidente } from './utils/apagar-foto-incidente.util';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';

// Ordem válida de transição de status: nunca "volta" para um estado anterior.
const ORDEM_DE_STATUS = ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'];

@Injectable()
export class IncidentsService {
  constructor(
    private servicoPrisma: PrismaService,
    private servicoSoftDelete: SoftDeleteService,
  ) {}

  // escopoDoUsuario: quem só tem INCIDENT_VIEW_OWN (não INCIDENT_VIEW_ALL)
  // tem o driverId da query IGNORADO e forçado para o próprio motorista.
  // Sem Driver vinculado, devolve lista vazia.
  async listar(
    page?: number,
    pageSize?: number,
    severity?: string,
    status?: string,
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
    if (severity) {
      where.severity = severity;
    }
    if (status) {
      where.status = status;
    }
    if (vehicleId) {
      where.vehicleId = vehicleId;
    }
    if (driverIdFiltro) {
      where.driverId = driverIdFiltro;
    }

    const [dados, total] = await Promise.all([
      this.servicoPrisma.comSoftDelete.incident.findMany({
        where,
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.servicoPrisma.comSoftDelete.incident.count({ where }),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async buscarPorId(id: string) {
    const incidente = await this.servicoPrisma.comSoftDelete.incident.findUnique({
      where: { id },
    });
    if (!incidente) {
      throw new NotFoundException('Incident not found');
    }
    return incidente;
  }

  async criar(
    dados: CreateIncidentDto,
    photoUrl: string | null,
    photoKey: string | null,
    idDoUsuario: string,
  ) {
    let idDoIncidenteCriado = '';

    let tripIdParametro: string | null = null;
    if (dados.tripId) {
      tripIdParametro = dados.tripId;
    }

    try {
      await this.servicoPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${idDoUsuario}::text, true)`;

        const resultado = await tx.$queryRaw<Array<{ id: string }>>`
          CALL register_incident(${tripIdParametro}::uuid, ${dados.vehicleId}::uuid, ${dados.driverId}::uuid, ${dados.type}, ${dados.severity}, ${dados.description}, ${photoUrl}, ${photoKey}, ${idDoUsuario}::uuid, NULL, NULL, NULL)
        `;
        idDoIncidenteCriado = resultado[0].id;
      });
    } catch (erro) {
      traduzirErroDeProcedure(erro);
    }

    return this.buscarPorId(idDoIncidenteCriado);
  }

  // Update direto e simples (sem procedure): só o campo status, e só andando
  // para frente (REPORTED -> UNDER_INVESTIGATION -> RESOLVED). Voltar um
  // incidente já resolvido para "reportado" não faz sentido no fluxo do projeto.
  async atualizarStatus(id: string, dados: UpdateIncidentStatusDto) {
    const incidente = await this.buscarPorId(id);

    const posicaoAtual = ORDEM_DE_STATUS.indexOf(incidente.status);
    const posicaoNova = ORDEM_DE_STATUS.indexOf(dados.status);

    if (posicaoNova <= posicaoAtual) {
      throw new BadRequestException(
        `Cannot change incident status from ${incidente.status} to ${dados.status}`,
      );
    }

    return this.servicoPrisma.incident.update({
      where: { id },
      data: { status: dados.status },
    });
  }

  // Soft delete não apaga o arquivo físico: o incidente pode ser restaurado
  // depois, e a foto precisa continuar existindo nesse caso.
  async remover(id: string): Promise<void> {
    await this.buscarPorId(id);
    await this.servicoSoftDelete.removerLogicamente('incident', id);
  }

  async restaurar(id: string) {
    const incidente = await this.servicoPrisma.incident.findUnique({ where: { id } });
    if (!incidente) {
      throw new NotFoundException('Incident not found');
    }

    return this.servicoSoftDelete.restaurar('incident', id);
  }

  async listarRemovidos(
    page?: number,
    pageSize?: number,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const [dados, total] = await Promise.all([
      this.servicoSoftDelete.listarRemovidos('incident', {
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
      }),
      this.servicoSoftDelete.contarRemovidos('incident'),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  // Hard delete: aqui sim apagamos o arquivo físico do disco, se existir.
  async removerPermanentemente(id: string): Promise<void> {
    const incidente = await this.servicoPrisma.incident.findUnique({ where: { id } });
    if (!incidente) {
      throw new NotFoundException('Incident not found');
    }

    await this.servicoSoftDelete.removerPermanentemente('incident', id);
    await apagarFotoDoIncidente(incidente.photoKey);
  }
}
