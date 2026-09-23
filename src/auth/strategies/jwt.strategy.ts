import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { ConfigVars } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UsuarioLogado } from '../interfaces/usuario-logado.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    servicoDeConfiguracao: ConfigService<ConfigVars, true>,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: servicoDeConfiguracao.getOrThrow('jwt.secret', {
        infer: true,
      }),
    });
  }

  // O que este método devolver vira o "request.user".
  async validate(carga: JwtPayload): Promise<UsuarioLogado> {
    // comSoftDelete: usuário soft-deletado nunca é encontrado aqui, então
    // o token dele para de funcionar mesmo antes de expirar.
    const usuario = await this.prisma.comSoftDelete.user.findUnique({
      where: { id: carga.sub },
      select: { id: true, isActive: true, email: true, roleId: true },
    });

    // Não revela se o token é inválido ou se o usuário só está inativo.
    if (!usuario) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!usuario.isActive) {
      throw new UnauthorizedException('User is inactive');
    }

    return {
      userId: usuario.id,
      email: usuario.email,
      roleId: usuario.roleId,
    };
  }
}
