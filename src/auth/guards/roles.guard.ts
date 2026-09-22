import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import { CHAVE_PAPEIS, CHAVE_PERMISSOES } from '../constants/auth.constants';
import { UsuarioLogado } from '../interfaces/usuario-logado.interface';

// Formato de um UUID (o id do papel no banco).
const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private refletor: Reflector,
    private servicoPrisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Lê o decorator do método e, se não achar, o da classe.
    const alvos = [context.getHandler(), context.getClass()];
    const papeisExigidos = this.refletor.getAllAndOverride<string[]>(
      CHAVE_PAPEIS,
      alvos,
    );
    const permissoesExigidas = this.refletor.getAllAndOverride<string[]>(
      CHAVE_PERMISSOES,
      alvos,
    );

    if (!papeisExigidos && !permissoesExigidas) {
      return true; // Nenhuma restrição
    }

    const requisicao = context
      .switchToHttp()
      .getRequest<{ user?: UsuarioLogado }>();
    const usuario = requisicao.user; // Preenchido pelo JwtAuthGuard

    if (!usuario) {
      throw new ForbiddenException('User not found in request');
    }

    // Sem um roleId válido, o Prisma ignoraria o filtro e liberaria tudo.
    if (
      typeof usuario.roleId !== 'string' ||
      !FORMATO_UUID.test(usuario.roleId)
    ) {
      throw new ForbiddenException('Invalid user role');
    }

    // Verificar roles
    if (papeisExigidos && papeisExigidos.length > 0) {
      const papelDoUsuario = await this.servicoPrisma.role.findUnique({
        where: { id: usuario.roleId },
      });

      if (!papelDoUsuario || !papeisExigidos.includes(papelDoUsuario.name)) {
        throw new ForbiddenException('Insufficient role');
      }
    }

    // Verificar permissions
    if (permissoesExigidas && permissoesExigidas.length > 0) {
      const permissoesDoPapel =
        await this.servicoPrisma.rolePermission.findMany({
          where: { roleId: usuario.roleId },
          include: { permission: true },
        });

      const codigosDePermissao = permissoesDoPapel.map(
        (item) => item.permission.code,
      );
      const temPermissao = permissoesExigidas.some((codigo) =>
        codigosDePermissao.includes(codigo),
      );

      if (!temPermissao) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return true;
  }
}
