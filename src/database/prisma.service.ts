import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigVars } from '../config/configuration';
import { PrismaClient } from '../generated/prisma/client';
import { extensaoSoftDelete } from './soft-delete.extension';

// Função solta só para o TypeScript inferir o tipo completo do client
// extendido (com $extends direto na classe, o tipo genérico vira "unknown").
function aplicarSoftDelete(cliente: PrismaClient) {
  return cliente.$extends(extensaoSoftDelete);
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // $extends() do Prisma 7 devolve um client NOVO, não dá pra "estender" a
  // classe com ele. Por isso guardamos o client com soft delete aqui: os
  // resources que precisam ignorar/soft-deletar usam servicoPrisma.comSoftDelete
  // em vez dos métodos herdados diretamente (ex: this.user).
  readonly comSoftDelete: ReturnType<typeof aplicarSoftDelete>;

  constructor(servicoDeConfiguracao: ConfigService<ConfigVars, true>) {
    // O adapter faz o Prisma falar com o PostgreSQL usando a URL do .env.
    const adaptador = new PrismaPg({
      connectionString: servicoDeConfiguracao.getOrThrow('database.url', {
        infer: true,
      }),
    });
    super({ adapter: adaptador });
    this.comSoftDelete = aplicarSoftDelete(this);
  }

  // Abre a conexão com o banco quando o módulo inicia.
  async onModuleInit() {
    await this.$connect();
  }

  // Fecha a conexão quando o app é encerrado.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
