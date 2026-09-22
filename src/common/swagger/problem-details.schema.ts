import { ApiProperty } from '@nestjs/swagger';

/**
 * Formato padrão de erro da API, seguindo a RFC 7807 (Problem Details).
 * As controllers devem referenciar este schema via $ref nas respostas de erro.
 */
export class ProblemDetailsDto {
  @ApiProperty({
    description: 'URI que identifica o tipo do erro.',
    example: 'https://api.frota.com/erros/credenciais-invalidas',
  })
  type: string;

  @ApiProperty({
    description: 'Resumo curto e legível do tipo do erro.',
    example: 'Credenciais inválidas',
  })
  title: string;

  @ApiProperty({
    description: 'Código de status HTTP da resposta.',
    example: 401,
  })
  status: number;

  @ApiProperty({
    description: 'Explicação detalhada do erro, específica para esta ocorrência.',
    example: 'O e-mail ou a senha informados não conferem.',
  })
  detail: string;

  @ApiProperty({
    description: 'URI que identifica a ocorrência específica do erro (geralmente o path da requisição).',
    example: '/auth/login',
  })
  instance: string;
}
