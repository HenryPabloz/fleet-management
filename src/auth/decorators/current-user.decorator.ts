import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UsuarioLogado } from '../interfaces/usuario-logado.interface';

// Devolve o usuário logado, que o JwtAuthGuard colocou no request.
export const CurrentUser = createParamDecorator(
  (dados: unknown, contexto: ExecutionContext): UsuarioLogado => {
    const requisicao = contexto
      .switchToHttp()
      .getRequest<{ user: UsuarioLogado }>();
    return requisicao.user;
  },
);
