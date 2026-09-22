import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Se der erro ou não tiver usuário, o token é inválido ou expirou.
  handleRequest<TUser>(erro: Error | null, usuario: TUser | false): TUser {
    if (erro || !usuario) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return usuario;
  }
}
