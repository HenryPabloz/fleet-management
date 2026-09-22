import { ApiProperty } from '@nestjs/swagger';

/**
 * Metadados de paginação retornados junto com listas de recursos.
 * Formato padrão do projeto: { data: [], pagination: { page, pageSize, total, totalPages } }.
 */
export class PaginacaoMetadataDto {
  @ApiProperty({ description: 'Página atual (começa em 1).', example: 1 })
  page!: number;

  @ApiProperty({ description: 'Quantidade de itens por página.', example: 20 })
  pageSize!: number;

  @ApiProperty({ description: 'Quantidade total de itens encontrados.', example: 150 })
  total!: number;

  @ApiProperty({ description: 'Quantidade total de páginas.', example: 8 })
  totalPages!: number;
}

/**
 * Envelope genérico de resposta paginada. As controllers devem estender ou
 * compor este schema (ex: via getSchemaPath + allOf) para documentar o
 * conteúdo real de "data" em cada endpoint de listagem.
 */
export class PaginacaoRespostaDto {
  @ApiProperty({
    description: 'Lista de itens da página atual.',
    isArray: true,
    type: () => Object,
  })
  data!: unknown[];

  @ApiProperty({ description: 'Metadados de paginação.', type: () => PaginacaoMetadataDto })
  pagination!: PaginacaoMetadataDto;
}
