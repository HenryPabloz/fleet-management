import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class PermissionsService {
  constructor(
    private servicoPrisma: PrismaService,
    private servicoUsers: UsersService,
  ) {}

  // Catálogo completo de permissões existentes no sistema.
  async listarCatalogo() {
    return this.servicoPrisma.permission.findMany({
      select: { id: true, code: true, description: true },
      orderBy: { code: 'asc' },
    });
  }

  // Combina as permissões herdadas do papel com as concedidas individualmente ao usuário.
  async listarPermissoesDoUsuario(usuarioId: string) {
    const usuario = await this.servicoUsers.buscarPorId(usuarioId);

    const [permissoesDoPapel, permissoesIndividuais] = await Promise.all([
      this.servicoPrisma.rolePermission.findMany({
        where: { roleId: usuario.roleId },
        include: { permission: true },
      }),
      this.servicoPrisma.userPermission.findMany({
        where: { userId: usuarioId },
        include: { permission: true },
      }),
    ]);

    return {
      fromRole: permissoesDoPapel.map((item) => item.permission.code),
      individual: permissoesIndividuais.map((item) => item.permission.code),
    };
  }

  // Concede uma permissão individualmente ao usuário. Idempotente: conceder de novo não é erro.
  async conceder(usuarioId: string, permissionCode: string) {
    await this.servicoUsers.buscarPorId(usuarioId);

    const permissao = await this.servicoPrisma.permission.findUnique({
      where: { code: permissionCode },
    });
    if (!permissao) {
      throw new BadRequestException('permissionCode does not exist');
    }

    await this.servicoPrisma.userPermission.upsert({
      where: {
        userId_permissionId: { userId: usuarioId, permissionId: permissao.id },
      },
      create: { userId: usuarioId, permissionId: permissao.id },
      update: {},
    });

    return this.listarPermissoesDoUsuario(usuarioId);
  }

  // Revoga a concessão individual. Idempotente: revogar quem já não tinha não é erro (ainda dá 204).
  async revogar(usuarioId: string, permissionCode: string): Promise<void> {
    await this.servicoUsers.buscarPorId(usuarioId);

    const permissao = await this.servicoPrisma.permission.findUnique({
      where: { code: permissionCode },
    });
    if (!permissao) {
      // Código de permissão inexistente: não há o que revogar, mas nada de errado com o usuário.
      return;
    }

    await this.servicoPrisma.userPermission.deleteMany({
      where: { userId: usuarioId, permissionId: permissao.id },
    });
  }
}
