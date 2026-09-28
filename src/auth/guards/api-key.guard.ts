import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { ConfigVars } from '../../config/configuration';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private servicoDeConfiguracao: ConfigService<ConfigVars, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const requisicao = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const chave = requisicao.headers['x-api-key'];

    if (chave === undefined) {
      throw new UnauthorizedException('API key required');
    }

    if (typeof chave !== 'string' || !this.chaveConfere(chave)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  // Compara em tempo constante para não vazar o tamanho/conteúdo da chave certa.
  // timingSafeEqual exige buffers do mesmo tamanho, então trata isso antes.
  private chaveConfere(chaveRecebida: string): boolean {
    const chaveEsperada = this.servicoDeConfiguracao.get('apiKey', { infer: true });
    const bufferRecebido = Buffer.from(chaveRecebida);
    const bufferEsperado = Buffer.from(chaveEsperada);

    if (bufferRecebido.length !== bufferEsperado.length) {
      return false;
    }
    return timingSafeEqual(bufferRecebido, bufferEsperado);
  }
}
