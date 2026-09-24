import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { calcularHashApiKey } from '../auth/utils/api-key.util';
import type { UsuarioLogado } from '../auth/interfaces/usuario-logado.interface';
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
import { TrocarRoleDto } from './dto/trocar-role.dto';
import { DadosMotoristaDto } from './dto/dados-motorista.dto';

// Custo do bcrypt para as senhas.
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

// Quanto maior o número, mais poder o papel tem (usado na troca de role).
const NIVEL_DO_PAPEL: Record<string, number> = {
  DRIVER: 1,
  FLEET_MANAGER: 2,
  ADMIN: 3,
};

// Só isto do motorista vai para a resposta.
const SELECAO_MOTORISTA = {
  id: true,
  licenseNumber: true,
  licenseExpiry: true,
  isActive: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private servicoPrisma: PrismaService,
    private servicoSoftDelete: SoftDeleteService,
    private servicoAuth: AuthService,
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

  // quemCria é o usuário logado: ele define quais papéis pode atribuir.
  async criar(dados: CreateUserDto, quemCria: UsuarioLogado) {
    const papel = await this.servicoPrisma.role.findUnique({
      where: { id: dados.roleId },
    });
    if (!papel) {
      throw new BadRequestException('roleId does not exist');
    }

    // Quem não é ADMIN (ex: FLEET_MANAGER) só pode criar motoristas.
    const papelDeQuemCria = await this.servicoPrisma.role.findUnique({
      where: { id: quemCria.roleId },
    });
    if (papelDeQuemCria?.name !== 'ADMIN' && papel.name !== 'DRIVER') {
      throw new ForbiddenException(
        'Only ADMIN can create users with a role other than DRIVER',
      );
    }

    if (papel.name === 'DRIVER' && !dados.driver) {
      throw new BadRequestException('driver block is required for the DRIVER role');
    }
    if (papel.name !== 'DRIVER' && dados.driver) {
      throw new BadRequestException(
        'driver block is only allowed for the DRIVER role',
      );
    }

    // Sem índice único parcial no Prisma neste projeto: um e-mail de usuário
    // soft-deletado fica bloqueado pra sempre (limitação conhecida, decisão já tomada).
    const emailJaExiste = await this.servicoPrisma.user.findUnique({
      where: { email: dados.email },
    });
    if (emailJaExiste) {
      throw new ConflictException('Email already registered');
    }
    const dadosDoMotorista = dados.driver;
    if (dadosDoMotorista) {
      await this.validarDadosDoMotorista(dadosDoMotorista);
    }

    const hashDaSenha = await bcrypt.hash(dados.password, CUSTO_BCRYPT);

    let isActive = true;
    if (dados.isActive !== undefined) {
      isActive = dados.isActive;
    }

    // A chave em texto só existe aqui e na resposta; o banco guarda o hash.
    const apiKey = this.servicoAuth.generateApiKey();

    const dadosDoUsuario = {
      email: dados.email,
      password: hashDaSenha,
      fullName: dados.fullName,
      roleId: dados.roleId,
      isActive,
      apiKey: calcularHashApiKey(apiKey),
      apiKeyCreatedAt: new Date(),
    };

    // Transação: se criar o motorista falhar, a conta também não é criada.
    try {
      return await this.servicoPrisma.$transaction(async (transacao) => {
        await transacao.$executeRaw`SELECT set_config('app.current_user_id', ${quemCria.userId}::text, true)`;
        const usuario = await transacao.user.create({
          data: dadosDoUsuario,
          select: SELECAO_SEGURA,
        });
        if (!dadosDoMotorista) {
          return { ...usuario, apiKey };
        }
        const motorista = await transacao.driver.create({
          data: {
            userId: usuario.id,
            licenseNumber: dadosDoMotorista.licenseNumber,
            licenseExpiry: new Date(dadosDoMotorista.licenseExpiry),
          },
          select: SELECAO_MOTORISTA,
        });
        return { ...usuario, apiKey, driver: motorista };
      });
    } catch (erro) {
      // Corrida entre a checagem e o insert: mesma resposta 409.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('Email or license number already registered');
      }
      throw erro;
    }
  }

  // Sobe ou desce o papel de um usuário (rota só de ADMIN com permission da direção).
  async trocarRole(id: string, dados: TrocarRoleDto, quemTroca: UsuarioLogado) {
    const alvo = await this.servicoPrisma.comSoftDelete.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!alvo) {
      throw new NotFoundException('User not found');
    }
    if (alvo.id === quemTroca.userId) {
      throw new ConflictException('You cannot change your own role');
    }

    const novoPapel = await this.servicoPrisma.role.findUnique({
      where: { id: dados.roleId },
    });
    if (!novoPapel) {
      throw new BadRequestException('roleId does not exist');
    }
    if (novoPapel.id === alvo.roleId) {
      throw new ConflictException('User already has this role');
    }

    // ADMIN nunca é rebaixado, nem por outro ADMIN.
    if (alvo.role.name === 'ADMIN') {
      throw new ForbiddenException('An ADMIN cannot be demoted');
    }

    const nivelAtual = NIVEL_DO_PAPEL[alvo.role.name] ?? 0;
    const nivelNovo = NIVEL_DO_PAPEL[novoPapel.name] ?? 0;
    let permissaoNecessaria = 'USER_ROLE_PROMOTE';
    if (nivelNovo < nivelAtual) {
      permissaoNecessaria = 'USER_ROLE_DEMOTE';
    }
    const temPermissao = await this.usuarioTemPermissao(quemTroca, permissaoNecessaria);
    if (!temPermissao) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // Só DRIVER leva perfil de motorista; se já existe um, ele é mantido.
    let novoMotorista: DadosMotoristaDto | undefined;
    if (novoPapel.name === 'DRIVER') {
      const motoristaExistente = await this.servicoPrisma.driver.findUnique({
        where: { userId: id },
      });
      if (!motoristaExistente) {
        if (!dados.driver) {
          throw new BadRequestException(
            'driver block is required to become DRIVER when the user has no driver profile',
          );
        }
        await this.validarDadosDoMotorista(dados.driver);
        novoMotorista = dados.driver;
      }
    } else if (dados.driver) {
      throw new BadRequestException(
        'driver block is only allowed for the DRIVER role',
      );
    }

    try {
      return await this.servicoPrisma.$transaction(async (transacao) => {
        await transacao.$executeRaw`SELECT set_config('app.current_user_id', ${quemTroca.userId}::text, true)`;
        const usuario = await transacao.user.update({
          where: { id },
          data: { roleId: novoPapel.id },
          select: SELECAO_SEGURA,
        });
        if (!novoMotorista) {
          return usuario;
        }
        const motorista = await transacao.driver.create({
          data: {
            userId: id,
            licenseNumber: novoMotorista.licenseNumber,
            licenseExpiry: new Date(novoMotorista.licenseExpiry),
          },
          select: SELECAO_MOTORISTA,
        });
        return { ...usuario, driver: motorista };
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('License number already registered');
      }
      throw erro;
    }
  }

  // Permission vale se vier do papel ou tiver sido delegada ao usuário.
  private async usuarioTemPermissao(
    usuario: UsuarioLogado,
    codigo: string,
  ): Promise<boolean> {
    const doPapel = await this.servicoPrisma.rolePermission.findFirst({
      where: { roleId: usuario.roleId, permission: { code: codigo } },
    });
    if (doPapel) {
      return true;
    }
    const individual = await this.servicoPrisma.userPermission.findFirst({
      where: { userId: usuario.userId, permission: { code: codigo } },
    });
    return individual !== null;
  }

  // Emite nova API key para outro usuário (ex: perdeu a dele). 404 se não existir.
  async regenerarApiKey(id: string) {
    await this.buscarPorId(id);
    return this.servicoAuth.regenerateApiKey(id);
  }

  private async validarDadosDoMotorista(motorista: {
    licenseNumber: string;
    licenseExpiry: string;
  }): Promise<void> {
    const cnhJaExiste = await this.servicoPrisma.driver.findUnique({
      where: { licenseNumber: motorista.licenseNumber },
    });
    if (cnhJaExiste) {
      throw new ConflictException('License number already registered');
    }
    if (new Date(motorista.licenseExpiry) < new Date()) {
      throw new BadRequestException('licenseExpiry cannot be in the past');
    }
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

    // Histórico de auditoria NÃO bloqueia: as linhas de audit_logs ficam com autor NULL.
    // Bloqueia só quem registrou viagens, abastecimentos, manutenções ou incidentes.
    const [viagemCriada, abastecimentoRegistrado, manutencaoRegistrada, incidenteRegistrado] =
      await Promise.all([
        this.servicoPrisma.trip.findFirst({ where: { createdBy: id } }),
        this.servicoPrisma.refueling.findFirst({ where: { registeredBy: id } }),
        this.servicoPrisma.maintenance.findFirst({ where: { registeredBy: id } }),
        this.servicoPrisma.incident.findFirst({ where: { registeredBy: id } }),
      ]);

    if (
      viagemCriada ||
      abastecimentoRegistrado ||
      manutencaoRegistrada ||
      incidenteRegistrado
    ) {
      throw new ConflictException(
        'Cannot permanently delete a user who registered trips, refuelings, maintenances or incidents.',
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
