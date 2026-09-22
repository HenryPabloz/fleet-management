import { Prisma } from '../generated/prisma/client';

// Models que têm coluna deletedAt e por isso participam do soft delete.
const MODELOS_COM_SOFT_DELETE = [
  'User',
  'Driver',
  'Vehicle',
  'Trip',
  'Refueling',
  'Maintenance',
  'Incident',
];

// Leituras que precisam esconder os registros já removidos.
const OPERACOES_DE_LEITURA = [
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
  // count também precisa ignorar removidos, senão a paginação bate errado.
  'count',
];

// Troca delete/deleteMany por update/updateMany (grava deletedAt em vez de apagar a linha).
// Repetido para os 7 models: o Prisma não deixa usar $allModels aqui, porque isso
// afetaria também Role/Permission/AuditLog, que não têm deletedAt.
function criarOperacoesDeRemocao() {
  return {
    // "this" é o client do próprio model (ex: client.user); pegamos o contexto
    // para poder chamar o "update" dele sem cair de novo nesta função.
    async delete(this: unknown, args: { where: Record<string, unknown> }) {
      const contexto = Prisma.getExtensionContext(this) as {
        update: (args: unknown) => Promise<unknown>;
      };
      return contexto.update({
        where: args.where,
        data: { deletedAt: new Date() },
      });
    },
    async deleteMany(
      this: unknown,
      args?: { where?: Record<string, unknown> },
    ) {
      const contexto = Prisma.getExtensionContext(this) as {
        updateMany: (args: unknown) => Promise<unknown>;
      };
      return contexto.updateMany({
        where: args?.where,
        data: { deletedAt: new Date() },
      });
    },
  };
}

// Extension do Prisma 7 (substitui o antigo $use, que foi removido).
export const extensaoSoftDelete = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    // $allOperations roda para toda operação de todo model; aqui só filtramos
    // leituras dos 7 models da lista, acrescentando deletedAt: null no where.
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ehModeloComSoftDelete =
          model !== undefined && MODELOS_COM_SOFT_DELETE.includes(model);
        const ehLeitura = OPERACOES_DE_LEITURA.includes(operation);

        if (!ehModeloComSoftDelete || !ehLeitura) {
          return query(args);
        }

        // any: o formato de "where" varia por model/operação, então tipar aqui não ajuda.
        const argumentosComFiltro = args as { where?: Record<string, unknown> };
        argumentosComFiltro.where = {
          ...argumentosComFiltro.where,
          deletedAt: null,
        };
        return query(argumentosComFiltro);
      },
    },
  },
  model: {
    user: criarOperacoesDeRemocao(),
    driver: criarOperacoesDeRemocao(),
    vehicle: criarOperacoesDeRemocao(),
    trip: criarOperacoesDeRemocao(),
    refueling: criarOperacoesDeRemocao(),
    maintenance: criarOperacoesDeRemocao(),
    incident: criarOperacoesDeRemocao(),
  },
});
