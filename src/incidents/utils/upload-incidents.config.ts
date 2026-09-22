import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

// Pasta local onde as fotos de incidente ficam (rodada futura: some daqui e
// vai pro S3, o photoKey já está pronto para virar a key do objeto lá).
export const PASTA_UPLOADS_INCIDENTS = join(process.cwd(), 'uploads', 'incidents');

export function garantirPastaDeUploads(): void {
  if (!existsSync(PASTA_UPLOADS_INCIDENTS)) {
    mkdirSync(PASTA_UPLOADS_INCIDENTS, { recursive: true });
  }
}

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'application/pdf'];

// Configuração do FileInterceptor('photo'): onde salvar, como nomear e o que aceitar.
export const configuracaoDeUploadDeIncidente = {
  storage: diskStorage({
    destination: (_requisicao, _arquivo, callback) => {
      garantirPastaDeUploads();
      callback(null, PASTA_UPLOADS_INCIDENTS);
    },
    filename: (_requisicao, arquivo, callback) => {
      const nomeUnico = `${randomUUID()}${extname(arquivo.originalname)}`;
      callback(null, nomeUnico);
    },
  }),
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
