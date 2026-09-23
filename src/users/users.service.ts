import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { SoftDeleteService } from '../common/services/soft-delete.service';
import {
  montarPaginacao,
  normalizarPaginacao,
  ResultadoPaginado,
} from '../common/utils/paginacao.util';
import { CreateUserDto } from './dto/create-user.dto';
import { ReplaceUserDto } from './dto/replace-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateMeuPerfilDto } from './dto/update-meu-perfil.dto';
import { TrocarSenhaDto } from './dto/trocar-senha.dto';

// Custo do bcrypt (mesmo valor usado no cadastro público de /auth/signup).
const CUSTO_BCRYPT = 10;

// Nunca inclui password/apiKey na resposta.
const SELECAO_SEGURA = {
  id: true,
  email: true,
  fullName: true,
  roleId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SELECAO_SEGURA_COM_DELETED_AT = {
  ...SELECAO_SEGURA,
  deletedAt: true,
} as const;

@Injectable()
export class UsersService {
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
      this.servicoPrisma.comSoftDelete.user.findMany({
        select: SELECAO_SEGURA,
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.servicoPrisma.comSoftDelete.user.count(),
    ]);

    return montarPaginacao(dados, total, paginacao.page, paginacao.pageSize);
  }

  async buscarPorId(id: string) {
    const usuario = await this.servicoPrisma.comSoftDelete.user.findUnique({
      where: { id },
      select: SELECAO_SEGURA,
    });
    if (!usuario) {
      throw new NotFoundException('User not found');
    }
    return usuario;
  }

  async criar(dados: CreateUserDto) {
    // Sem índice único parcial no Prisma neste projeto: um e-mail de usuário
    // soft-deletado fica bloqueado pra sempre (limitação conhecida, decisão já tomada).
    const emailJaExiste = await this.servicoPrisma.user.findUnique({
      where: { email: dados.email },
    });
    if (emailJaExiste) {
      throw new ConflictException('Email already registered');
    }

    const papel = await this.servicoPrisma.role.findUnique({
      where: { id: dados.roleId },
    });
    if (!papel) {
      throw new BadRequestException('roleId does not exist');
    }

    const hashDaSenha = await bcrypt.hash(dados.password, CUSTO_BCRYPT);

    let isActive = true;
    if (dados.isActive !== undefined) {
      isActive = dados.isActive;
    }

    return this.servicoPrisma.user.create({
      data: {
        email: dados.email,
        password: hashDaSenha,
        fullName: dados.fullName,
        roleId: dados.roleId,
        isActive,
      },
      select: SELECAO_SEGURA,
    });
  }

  async atualizarParcial(id: string, dados: UpdateUserDto) {
    await this.buscarPorId(id);

    if (dados.roleId) {
      await this.validarRoleId(dados.roleId);
    }

    return this.servicoPrisma.user.update({
      where: { id },
      data: {
        fullName: dados.fullName,
        roleId: dados.roleId,
        isActive: dados.isActive,
      },
      select: SELECAO_SEGURA,
    });
  }

  async substituir(id: string, dados: ReplaceUserDto) {
    await this.buscarPorId(id);
    await this.validarRoleId(dados.roleId);

    return this.servicoPrisma.user.update({
      where: { id },
      data: {
        fullName: dados.fullName,
        roleId: dados.roleId,
        isActive: dados.isActive,
      },
      select: SELECAO_SEGURA,
    });
  }

  async remover(id: string): Promise<void> {
    await this.buscarPorId(id);
    await this.servicoSoftDelete.removerLogicamente('user', id);

    // Propaga o soft delete pro Driver vinculado, se houver um ainda ativo.
    // Assimetria proposital: restaurar o User NÃO restaura o Driver junto (ver restaurar()).
    const driverVinculado = await this.servicoPrisma.driver.findFirst({
      where: { userId: id, deletedAt: null },
    });
    if (driverVinculado) {
      await this.servicoSoftDelete.removerLogicamente('driver', driverVinculado.id);
    }
  }

  async restaurar(id: string) {
    const usuario = await this.servicoPrisma.user.findUnique({
      where: { id },
    });
    if (!usuario) {
      throw new NotFoundException('User not found');
    }

    // Mesma seleção segura das outras rotas de User: nunca devolve password/apiKey.
    return this.servicoSoftDelete.restaurar('user', id, SELECAO_SEGURA);
  }

  async listarRemovidos(
    page?: number,
    pageSize?: number,
  ): Promise<ResultadoPaginado<unknown>> {
    const paginacao = normalizarPaginacao(page, pageSize);

    const [dados, total] = await Promise.all([
      this.servicoSoftDelete.listarRemovidos('user', {
        skip: (paginacao.page - 1) * paginacao.pageSize,
        take: paginacao.pageSize,
      }),
      this.servicoSoftDelete.contarRemovidos('user'),
    ]);

    // O select não roda no listarRemovidos genérico; tiramos os campos sensíveis aqui.
    const dadosSemSegredos = (dados as Record<string, unknown>[]).map(
      (registro) => {
        const copia = { ...registro };
        delete copia.password;
        delete copia.apiKey;
        return copia;
      },
    );

    return montarPaginacao(
      dadosSemSegredos,
      total,
      paginacao.page,
      paginacao.pageSize,
    );
  }

  async removerPermanentemente(id: string): Promise<void> {
    const usuario = await this.servicoPrisma.user.findUnique({
      where: { id },
    });
    if (!usuario) {
      throw new NotFoundException('User not found');
    }

    // Busca sem filtro de soft delete: a FK tem ON DELETE CASCADE e apagaria
    // o Driver (ativo ou soft-deletado) junto, sem aviso. Bloqueamos antes.
    const driverVinculado = await this.servicoPrisma.driver.findUnique({
      where: { userId: id },
    });
    if (driverVinculado) {
      throw new ConflictException(
        'Cannot permanently delete a user with an associated driver record. Delete the driver first.',
      );
    }

    // audit_logs é append-only (trigger bloqueia UPDATE/DELETE): usuário com
    // qualquer linha lá nunca pode ser hard-deletado, por design (trilha íntegra).
    const [logDeAuditoria, viagemCriada, abastecimentoRegistrado, manutencaoRegistrada, incidenteRegistrado] =
      await Promise.all([
        this.servicoPrisma.auditLog.findFirst({ where: { changedBy: id } }),
        this.servicoPrisma.trip.findFirst({ where: { createdBy: id } }),
        this.servicoPrisma.refueling.findFirst({ where: { registeredBy: id } }),
        this.servicoPrisma.maintenance.findFirst({ where: { registeredBy: id } }),
        this.servicoPrisma.incident.findFirst({ where: { registeredBy: id } }),
      ]);

    if (
      logDeAuditoria ||
      viagemCriada ||
      abastecimentoRegistrado ||
      manutencaoRegistrada ||
      incidenteRegistrado
    ) {
      throw new ConflictException(
        'Cannot permanently delete a user with associated history (driver record, audit log, trips, refuelings, maintenances or incidents). This preserves the integrity of the audit trail.',
      );
    }

    await this.servicoSoftDelete.removerPermanentemente('user', id);
  }

  // GET /users/me: mesmo formato seguro de buscarPorId, mas pelo id de quem
  // está logado (não é um parâmetro de rota livre).
  async buscarMeuPerfil(userId: string) {
    return this.buscarPorId(userId);
  }

  // PATCH /users/me: só fullName. E-mail/senha/roleId/isActive não entram
  // aqui (ver UpdateMeuPerfilDto).
  async atualizarMeuPerfil(userId: string, dados: UpdateMeuPerfilDto) {
    await this.buscarPorId(userId);

    return this.servicoPrisma.user.update({
      where: { id: userId },
      data: { fullName: dados.fullName },
      select: SELECAO_SEGURA,
    });
  }

  // PATCH /users/me/password: exige a senha atual correta antes de trocar.
  async trocarSenha(userId: string, dados: TrocarSenhaDto): Promise<void> {
    const usuario = await this.servicoPrisma.user.findUnique({
      where: { id: userId },
    });
    if (!usuario) {
      throw new NotFoundException('User not found');
    }

    const senhaAtualCorreta = await bcrypt.compare(
      dados.currentPassword,
      usuario.password,
    );
    if (!senhaAtualCorreta) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const novoHash = await bcrypt.hash(dados.newPassword, CUSTO_BCRYPT);

    await this.servicoPrisma.user.update({
      where: { id: userId },
      data: { password: novoHash },
    });
  }

  private async validarRoleId(roleId: string): Promise<void> {
    const papel = await this.servicoPrisma.role.findUnique({
      where: { id: roleId },
    });
    if (!papel) {
      throw new BadRequestException('roleId does not exist');
    }
  }
}
