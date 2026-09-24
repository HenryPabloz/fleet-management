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

// Perfil de motorista devolvido junto do usuário (POST /users e PATCH /users/:id/role).
export class MotoristaResumoDto {
  @ApiProperty({ description: 'Identificador do motorista (UUID).', example: 'c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e5f' })
  id: string;

  @ApiProperty({ description: 'Número da CNH.', example: '12345678900' })
  licenseNumber: string;

  @ApiProperty({ description: 'Validade da CNH.', example: '2030-08-30T00:00:00.000Z' })
  licenseExpiry: string;

  @ApiProperty({ description: 'Se o motorista está ativo.', example: true })
  isActive: boolean;
}

// Usuário + perfil de motorista (só aparece quando existe).
export class UserComMotoristaRespostaDto extends UserRespostaDto {
  @ApiProperty({ required: false, type: () => MotoristaResumoDto, description: 'Perfil de motorista, quando houver.' })
  driver?: MotoristaResumoDto;
}

// Resposta de POST /users: inclui a API key em texto, mostrada uma única vez.
export class UserCriadoRespostaDto extends UserComMotoristaRespostaDto {
  @ApiProperty({
    description:
      'API key em texto (64 hex). Aparece SÓ nesta resposta: o banco guarda apenas o hash. Guarde e entregue ao usuário.',
    example: '9f2c4b7a1d0e8c3f5a6b2d9e7c1f4a8b3e6d0c5f9a2b7e1d4c8f3a6b0e5d9c21',
  })
  apiKey: string;
}
