import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { AxiosError } from 'axios';
import { ViaCepEnderecoDto } from './dto/via-cep-endereco.dto';
import { ViaCepResposta, ViaCepRespostaSucesso } from './interfaces/via-cep-resposta.interface';

// Integração real com a API pública do ViaCEP (https://viacep.com.br), via
// HttpService (@nestjs/axios) — sem mock, é chamada de rede de verdade.
@Injectable()
export class ViaCepService {
  private readonly logger = new Logger(ViaCepService.name);
  private readonly urlBase: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.urlBase = this.configService.get<string>('external.cepApiUrl', 'https://viacep.com.br/ws');
    this.timeoutMs = this.configService.get<number>('external.cepTimeoutMs', 10000);
  }

  // Busca o endereço de um CEP. Lança exceção HTTP em qualquer problema
  // (formato inválido, CEP não encontrado, timeout, erro de rede/servidor).
  async buscarPorCep(cep: string): Promise<ViaCepEnderecoDto> {
    const cepLimpo = this.limparMascara(cep);

    // Formato errado nem chega a sair pra rede: falha rápido, sem esperar timeout.
    if (!/^\d{8}$/.test(cepLimpo)) {
      throw new BadRequestException(
        `CEP inválido: esperado 8 dígitos (ex: 01310-100 ou 01310100), recebido "${cep}"`,
      );
    }

    const resposta = await this.chamarApi(cepLimpo, cep);

    // A API do ViaCEP devolve o campo "erro" como STRING "true" (não boolean
    // true), então checamos truthy em vez de igualdade estrita.
    if (resposta.erro) {
      throw new BadRequestException(`CEP ${cep} não encontrado`);
    }

    return this.enriquecer(resposta);
  }

  // Tenta buscar o CEP e devolve true/false. Só vira "false" o que realmente
  // é CEP inválido (formato errado ou não encontrado). Indisponibilidade do
  // ViaCEP (timeout, rate limit, erro de rede/5xx) não é "CEP inválido" —
  // relança pro validador propagar como erro do servidor (502/504), não 400.
  async cepEhValido(cep: string): Promise<boolean> {
    try {
      await this.buscarPorCep(cep);
      return true;
    } catch (erro) {
      if (erro instanceof BadRequestException) {
        return false;
      }
      throw erro;
    }
  }

  private async chamarApi(cepLimpo: string, cepOriginal: string): Promise<ViaCepResposta> {
    try {
      const resposta = await firstValueFrom(
        this.httpService.get<ViaCepResposta>(`${this.urlBase}/${cepLimpo}/json/`).pipe(
          timeout(this.timeoutMs),
          catchError((erro) => {
            throw erro;
          }),
        ),
      );
      return resposta.data;
    } catch (erro) {
      throw this.traduzirErroDeRede(erro, cepOriginal);
    }
  }

  // Timeout, erro de conexão, rate limit (429) e erro de servidor (5xx) viram
  // exceções HTTP diferentes, para o cliente da nossa API entender o que houve.
  private traduzirErroDeRede(erro: unknown, cepOriginal: string): Error {
    if (erro instanceof Error && erro.name === 'TimeoutError') {
      this.logger.error(`Timeout ao consultar ViaCEP para o CEP ${cepOriginal}`);
      return new GatewayTimeoutException(
        `Tempo esgotado ao consultar a API do ViaCEP (${this.timeoutMs}ms)`,
      );
    }

    const erroAxios = erro as AxiosError;

    if (
      erroAxios?.code === 'ECONNREFUSED' ||
      erroAxios?.code === 'ENOTFOUND' ||
      erroAxios?.code === 'ETIMEDOUT'
    ) {
      this.logger.error(`Erro de rede ao consultar ViaCEP: ${erroAxios.code}`);
      return new BadGatewayException('Não foi possível conectar à API do ViaCEP');
    }

    const status = erroAxios?.response?.status;

    if (status === 429) {
      this.logger.warn('ViaCEP retornou 429 (rate limit)');
      return new GatewayTimeoutException('API do ViaCEP com limite de requisições excedido');
    }

    if (status !== undefined && status >= 500) {
      this.logger.error(`ViaCEP retornou erro de servidor: ${status}`);
      return new BadGatewayException(`API do ViaCEP retornou erro (${status})`);
    }

    this.logger.error(`Erro inesperado ao consultar ViaCEP: ${(erro as Error)?.message}`);
    return new BadGatewayException('Erro inesperado ao consultar a API do ViaCEP');
  }

  private limparMascara(cep: string): string {
    return cep.replace(/\D/g, '');
  }

  private enriquecer(dados: ViaCepRespostaSucesso): ViaCepEnderecoDto {
    return {
      cep: dados.cep,
      logradouro: dados.logradouro,
      complemento: dados.complemento,
      bairro: dados.bairro,
      localidade: dados.localidade,
      uf: dados.uf,
      ibge: dados.ibge,
      gia: dados.gia,
      ddd: dados.ddd,
      siafi: dados.siafi,
      fullAddress: `${dados.localidade}, ${dados.uf}`,
    };
  }
}
