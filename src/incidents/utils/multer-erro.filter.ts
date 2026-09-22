import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

// Sem este filtro, um upload grande demais vira 500 (MulterError cru) ou 413
// (o FileInterceptor do Nest já traduz LIMIT_FILE_SIZE para
// PayloadTooLargeException sozinho). Aqui padronizamos os dois casos para 400,
// que é o status pedido para "arquivo inválido enviado pelo cliente".
@Catch(MulterError, PayloadTooLargeException)
export class MulterErrorFilter implements ExceptionFilter {
  catch(excecao: MulterError | PayloadTooLargeException, host: ArgumentsHost): void {
    const contexto = host.switchToHttp();
    const resposta = contexto.getResponse<Response>();

    let mensagem = excecao.message;
    if (excecao instanceof PayloadTooLargeException) {
      mensagem = 'File exceeds the maximum allowed size (10MB)';
    }

    resposta.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: `Upload error: ${mensagem}`,
      error: 'Bad Request',
    });
  }
}
