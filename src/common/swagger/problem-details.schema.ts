import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Formato REAL de erro devolvido pela API (RFC 7807 - Problem Details),
 * content-type `application/problem+json`. Todo erro (HttpException lançada
 * pelos guards/services, ValidationPipe global, ou erro não tratado) passa
 * pelo GlobalExceptionFilter e sai nesse envelope.
 */
export class ProblemDetailsDto {
  @ApiProperty({
    description: 'URI que identifica o tipo/categoria do erro (não precisa ser uma página real).',
    example: 'https://fleet-management.local/errors/not-found',
  })
  type!: string;

  @ApiProperty({
    description: 'Título curto e fixo para esse tipo de erro.',
    example: 'Recurso não encontrado',
  })
  title!: string;

  @ApiProperty({
    description: 'Código de status HTTP da resposta (repetido aqui, como manda a RFC 7807).',
    example: 404,
  })
  status!: number;

  @ApiProperty({
    description: 'Mensagem específica do que deu errado nesta requisição.',
    example: 'User not found',
  })
  detail!: string;

  @ApiProperty({
    description: 'Caminho da rota que gerou o erro.',
    example: '/users/b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f',
  })
  instance!: string;

  @ApiPropertyOptional({
    description:
      'Extensão fora do padrão RFC 7807: lista de mensagens, uma por campo inválido. ' +
      'Só aparece quando o erro vem do ValidationPipe (corpo/query inválidos).',
    type: [String],
    example: ['email must be an email', 'password must be longer than or equal to 8 characters'],
  })
  errors?: string[];
}
