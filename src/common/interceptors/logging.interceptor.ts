import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { UsuarioLogado } from '../../auth/interfaces/usuario-logado.interface';

// Loga cada requisição (método, rota, usuário, status, duração).
// Nunca loga corpo, headers, senha, token ou API key: só metadados.
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private registro = new Logger('Requisicao');

  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const requisicao = contexto
      .switchToHttp()
      .getRequest<{ method: string; url: string; user?: UsuarioLogado }>();
    const resposta = contexto.switchToHttp().getResponse<{ statusCode: number }>();

    const inicio = Date.now();
    const metodo = requisicao.method;
    const rota = requisicao.url;
    let idUsuario = 'anonimo';
    if (requisicao.user?.userId) {
      idUsuario = requisicao.user.userId;
    }

    return proximo.handle().pipe(
      tap(() => {
        const duracao = Date.now() - inicio;
        this.registro.log(
          `${metodo} ${rota} ${resposta.statusCode} ${duracao}ms user=${idUsuario}`,
        );
      }),
    );
  }
}
