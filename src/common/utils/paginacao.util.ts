export const TAMANHO_PAGINA_PADRAO = 20;
export const NUMERO_PAGINA_PADRAO = 1;

export interface ResultadoPaginado<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// Se page/pageSize não vierem na query, usa os valores padrão do projeto.
export function normalizarPaginacao(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number } {
  let paginaNormalizada = NUMERO_PAGINA_PADRAO;
  if (page) {
    paginaNormalizada = page;
  }

  let tamanhoNormalizado = TAMANHO_PAGINA_PADRAO;
  if (pageSize) {
    tamanhoNormalizado = pageSize;
  }

  return { page: paginaNormalizada, pageSize: tamanhoNormalizado };
}

// Monta o envelope { data, pagination } no formato padrão do projeto.
export function montarPaginacao<T>(
  dados: T[],
  total: number,
  page: number,
  pageSize: number,
): ResultadoPaginado<T> {
  return {
    data: dados,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
