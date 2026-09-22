import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';
import { UsuarioLogado } from '../interfaces/usuario-logado.interface';
import { calcularHashApiKey } from '../utils/api-key.util';

// A chave tem sempre 64 letras/números minúsculos (hexadecimal).
const FORMATO_API_KEY = /^[0-9a-f]{64}$/;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private servicoAuth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requisicao = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: UsuarioLogado;
    }>();
    const chave = requisicao.headers['x-api-key'];

    if (chave === undefined) {
      throw new UnauthorizedException('API key required');
    }

    // Formato ruim (ou cabeçalho repetido) é recusado sem consultar o banco.
    if (typeof chave !== 'string' || !FORMATO_API_KEY.test(chave)) {
      throw new UnauthorizedException('Invalid API key');
    }

    const usuario = await this.servicoAuth.validateApiKey(
      calcularHashApiKey(chave),
    );

    if (!usuario) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!usuario.isActive) {
      throw new ForbiddenException('User account is inactive');
    }

    await this.servicoAuth.registrarUsoDaApiKey(usuario.id);

    requisicao.user = {
      userId: usuario.id,
      email: usuario.email,
      roleId: usuario.roleId,
    };

    return true;
  }
}
