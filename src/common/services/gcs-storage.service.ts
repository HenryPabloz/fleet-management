import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import type { ConfigVars } from '../../config/configuration';

// Serviço genérico de upload/remoção de arquivos no bucket do Google Cloud
// Storage. Hoje só os incidentes usam, mas fica em common para outro módulo
// reaproveitar sem duplicar a configuração do cliente do GCS.
@Injectable()
export class GcsStorageService {
  private clienteStorage: Storage;
  private nomeDoBucket: string;

  constructor(private servicoDeConfiguracao: ConfigService<ConfigVars, true>) {
    const configuracaoGcs = this.servicoDeConfiguracao.get('gcs', { infer: true });
    this.nomeDoBucket = configuracaoGcs.bucketName;
    this.clienteStorage = new Storage({
      projectId: configuracaoGcs.projectId,
      keyFilename: configuracaoGcs.keyFile,
    });
  }

  // Envia o arquivo (em memória) para o bucket, com um nome único, e o deixa
  // público. Devolve a key (nome do objeto) e a URL pública para acessá-lo.
  async enviarArquivo(
    conteudo: Buffer,
    nomeOriginal: string,
    tipoDoConteudo: string,
  ): Promise<{ url: string; key: string }> {
    const chave = `${randomUUID()}${extname(nomeOriginal)}`;
    const bucket = this.clienteStorage.bucket(this.nomeDoBucket);
    const arquivo = bucket.file(chave);

    // O bucket usa "uniform bucket-level access", então a leitura pública vem
    // de uma política IAM no bucket (allUsers = Storage Object Viewer), não
    // de uma ACL por objeto — por isso não passamos `public: true` aqui.
    await arquivo.save(conteudo, { contentType: tipoDoConteudo });

    return {
      url: `https://storage.googleapis.com/${this.nomeDoBucket}/${chave}`,
      key: chave,
    };
  }

  // Apaga o arquivo do bucket, se existir. Se já sumiu, não faz mal e não dá erro.
  async apagarArquivo(chave: string | null): Promise<void> {
    if (!chave) {
      return;
    }
    const bucket = this.clienteStorage.bucket(this.nomeDoBucket);
    try {
      await bucket.file(chave).delete();
    } catch (erro: unknown) {
      const erroComCodigo = erro as { code?: number };
      if (erroComCodigo.code !== 404) {
        throw erro;
      }
    }
  }
}
