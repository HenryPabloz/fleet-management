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

// Extension do Prisma 7 (substitui o antigo $use, que foi removido).
// Só filtra leituras (esconde registros já removidos); delete/deleteMany não
// são sobrescritos aqui — hard delete de verdade usa o client sem extension
// (ver SoftDeleteService.removerPermanentemente), e soft delete usa update
// direto (ver SoftDeleteService.removerLogicamente).
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
});
