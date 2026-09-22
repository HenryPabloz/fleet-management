import { ApiProperty } from '@nestjs/swagger';

/**
 * Formato REAL de erro devolvido pela API hoje.
 *
 * O projeto ainda não tem um exception filter customizado (não há nenhum
 * `@Catch`/`useGlobalFilters` em `src/`), então toda `HttpException` lançada
 * pelos guards/services (e também o `ValidationPipe` global) cai no filtro
 * padrão do Nest, que devolve exatamente este formato — não é RFC 7807.
 * Existe um `ProblemDetailsDto` (RFC 7807) em `problem-details.schema.ts`
 * pronto para o dia em que um filtro assim for implementado; até lá, as
 * controllers devem referenciar este schema nas respostas de erro.
 */
export class ErroPadraoDto {
  @ApiProperty({
    description: 'Código de status HTTP da resposta.',
    example: 404,
  })
  statusCode!: number;

  @ApiProperty({
    description:
      'Mensagem do erro. É uma string única para a maioria dos erros ' +
      '(ex: NotFoundException), mas vira uma lista quando o ValidationPipe ' +
      'reprova o corpo da requisição (uma mensagem por campo inválido).',
    oneOf: [
      { type: 'string', example: 'User not found' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['email must be an email', 'password must be longer than or equal to 8 characters'],
      },
    ],
  })
  message!: string | string[];

  @ApiProperty({
    description: 'Nome curto do status HTTP.',
    example: 'Not Found',
  })
  error!: string;
}
