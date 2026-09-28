import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'application/pdf'];

// Configuração do FileInterceptor('photo'): guarda o arquivo em memória
// (como Buffer) para ser enviado ao Google Cloud Storage logo em seguida,
// e o que aceitar.
export const configuracaoDeUploadDeIncidente = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (
    _requisicao: unknown,
    arquivo: Express.Multer.File,
    callback: (erro: Error | null, aceitar: boolean) => void,
  ) => {
    if (!TIPOS_ACEITOS.includes(arquivo.mimetype)) {
      callback(
        new BadRequestException(
          'Invalid file type (only image/jpeg, image/png or application/pdf are allowed)',
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
};
