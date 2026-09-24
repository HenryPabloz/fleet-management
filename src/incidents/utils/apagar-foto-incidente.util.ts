import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PASTA_UPLOADS_INCIDENTS } from './upload-incidents.config';

// Apaga a foto do disco, se existir. Se já sumiu, não faz mal e não dá erro.
export async function apagarFotoDoIncidente(chaveDaFoto: string | null): Promise<void> {
  if (!chaveDaFoto) {
    return;
  }
  const caminhoDoArquivo = join(PASTA_UPLOADS_INCIDENTS, chaveDaFoto);
  if (existsSync(caminhoDoArquivo)) {
    try {
      await unlink(caminhoDoArquivo);
    } catch {
      // Arquivo já pode ter sido apagado por fora; não bloqueia a remoção do registro.
    }
  }
}
