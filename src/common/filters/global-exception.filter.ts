import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// URI base usada nos "type" do RFC 7807. Não precisa apontar pra uma página
// real, só identifica a categoria do erro de forma estável.
const BASE_URI_TIPO_ERRO = 'https://fleet-management.local/errors';

// Um "slug" (parte final da URI de tipo) e um título curto por status HTTP.
const SLUG_E_TITULO_POR_STATUS: Record<number, { slug: string; titulo: string }> = {
  [HttpStatus.BAD_REQUEST]: { slug: 'validation-error', titulo: 'Requisição inválida' },
  [HttpStatus.UNAUTHORIZED]: { slug: 'unauthorized', titulo: 'Não autenticado' },
  [HttpStatus.FORBIDDEN]: { slug: 'insufficient-permissions', titulo: 'Sem permissão' },
  [HttpStatus.NOT_FOUND]: { slug: 'not-found', titulo: 'Recurso não encontrado' },
  [HttpStatus.CONFLICT]: { slug: 'conflict', titulo: 'Conflito com o estado atual' },
  [HttpStatus.TOO_MANY_REQUESTS]: { slug: 'too-many-requests', titulo: 'Excesso de requisições' },
  [HttpStatus.INTERNAL_SERVER_ERROR]: { slug: 'internal-error', titulo: 'Erro interno' },
};

function slugETituloPadrao(status: number): { slug: string; titulo: string } {
  if (status in SLUG_E_TITULO_POR_STATUS) {
    return SLUG_E_TITULO_POR_STATUS[status];
  }
  return { slug: 'error', titulo: 'Erro' };
}

// Formato RFC 7807 (Problem Details) devolvido pela API. Substitui por
// completo o formato antigo do Nest ({ statusCode, message, error }) em
// TODAS as rotas — mudança de contrato intencional.
interface CorpoDoProblema {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors?: string[];
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(excecao: unknown, host: ArgumentsHost): void {
    const contextoHttp = host.switchToHttp();
    const resposta = contextoHttp.getResponse<Response>();
    const requisicao = contextoHttp.getRequest<Request>();

    if (excecao instanceof HttpException) {
      this.tratarHttpException(excecao, requisicao, resposta);
      return;
    }

    // Qualquer coisa que não seja HttpException é bug/falha inesperada: loga
    // o erro de verdade (com stack) e devolve 500 genérico pro cliente.
    this.logger.error(
      `Erro não tratado em ${requisicao.method} ${requisicao.url}`,
      excecao instanceof Error ? excecao.stack : String(excecao),
    );
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    const { slug, titulo } = slugETituloPadrao(status);
    const corpo: CorpoDoProblema = {
      type: `${BASE_URI_TIPO_ERRO}/${slug}`,
      title: titulo,
      status,
      detail: 'Erro interno inesperado.',
      instance: requisicao.url,
    };
    resposta.status(status).contentType('application/problem+json').json(corpo);
  }

  private tratarHttpException(
    excecao: HttpException,
    requisicao: Request,
    resposta: Response,
  ): void {
    const status = excecao.getStatus();
    const { slug, titulo } = slugETituloPadrao(status);
    const respostaOriginal = excecao.getResponse();

    const corpo: CorpoDoProblema = {
      type: `${BASE_URI_TIPO_ERRO}/${slug}`,
      title: titulo,
      status,
      detail: this.extrairDetail(excecao, respostaOriginal),
      instance: requisicao.url,
    };

    const listaDeErros = this.extrairListaDeErros(respostaOriginal);
    if (listaDeErros) {
      corpo.errors = listaDeErros;
    }

    resposta.status(status).contentType('application/problem+json').json(corpo);
  }

  // "detail" reaproveita a mensagem que a exceção já carregava. Quando o
  // ValidationPipe devolve uma lista (uma mensagem por campo), o detail vira
  // um resumo e a lista completa some para o campo extra "errors".
  private extrairDetail(excecao: HttpException, respostaOriginal: unknown): string {
    if (typeof respostaOriginal === 'string') {
      return respostaOriginal;
    }
    if (this.ehObjetoComMessage(respostaOriginal)) {
      const mensagem = respostaOriginal.message;
      if (Array.isArray(mensagem)) {
        return 'Um ou mais campos da requisição são inválidos.';
      }
      if (typeof mensagem === 'string') {
        return mensagem;
      }
    }
    return excecao.message;
  }

  private extrairListaDeErros(respostaOriginal: unknown): string[] | null {
    if (this.ehObjetoComMessage(respostaOriginal) && Array.isArray(respostaOriginal.message)) {
      return respostaOriginal.message;
    }
    return null;
  }

  private ehObjetoComMessage(
    valor: unknown,
  ): valor is { message: string | string[] } {
    return (
      typeof valor === 'object' &&
      valor !== null &&
      'message' in valor
    );
  }
}
