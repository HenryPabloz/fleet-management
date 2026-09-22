import { ApiProperty } from '@nestjs/swagger';

/**
 * Formato real devolvido pelas rotas de users (ver `SELECAO_SEGURA` em
 * `users.service.ts`): nunca inclui password nem apiKey.
 */
export class UserRespostaDto {
  @ApiProperty({
    description: 'Identificador do usuário (UUID).',
    example: 'b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f',
  })
  id: string;

  @ApiProperty({
    description: 'E-mail do usuário, sempre em minúsculas.',
    example: 'motorista@fleet.com',
  })
  email: string;

  @ApiProperty({ description: 'Nome completo.', example: 'João da Silva' })
  fullName: string;

  @ApiProperty({
    description: 'Identificador do papel (role) do usuário (UUID).',
    example: 'f1e2d3c4-b5a6-4978-8899-001122334455',
  })
  roleId: string;

  @ApiProperty({ description: 'Se o usuário está ativo.', example: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Data de criação do registro.',
    example: '2026-01-15T12:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Data da última atualização do registro.',
    example: '2026-02-20T09:30:00.000Z',
  })
  updatedAt: string;
}

/**
 * Formato devolvido por `GET /users/deleted/all`: os mesmos campos de
 * `UserRespostaDto` mais `deletedAt` (data do soft delete).
 */
export class UserRemovidoRespostaDto extends UserRespostaDto {
  @ApiProperty({
    description: 'Data em que o usuário foi removido (soft delete).',
    example: '2026-03-01T18:45:00.000Z',
  })
  deletedAt: string;
}
