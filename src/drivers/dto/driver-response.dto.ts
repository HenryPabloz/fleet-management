import { ApiProperty } from '@nestjs/swagger';

/**
 * Formato real devolvido pelas rotas de drivers: o `DriversService` não usa
 * `select`, então a linha inteira do banco volta, inclusive `deletedAt`
 * (fica `null` enquanto o motorista não é removido).
 */
export class DriverRespostaDto {
  @ApiProperty({
    description: 'Identificador do motorista (UUID).',
    example: 'a1b2c3d4-e5f6-4788-9900-112233445566',
  })
  id!: string;

  @ApiProperty({
    description: 'Identificador do usuário vinculado a este motorista (UUID).',
    example: 'b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f',
  })
  userId!: string;

  @ApiProperty({
    description: 'Número da CNH (único no sistema).',
    example: '12345678900',
  })
  licenseNumber!: string;

  @ApiProperty({
    description: 'Data de validade da CNH.',
    example: '2027-08-30',
  })
  licenseExpiry!: string;

  @ApiProperty({ description: 'Se o motorista está ativo.', example: true })
  isActive!: boolean;

  @ApiProperty({
    description: 'Data de criação do registro.',
    example: '2026-01-15T12:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Data da última atualização do registro.',
    example: '2026-02-20T09:30:00.000Z',
  })
  updatedAt!: string;

  @ApiProperty({
    description:
      'Data em que o motorista foi removido (soft delete). Nulo enquanto ativo.',
    example: null,
    nullable: true,
  })
  deletedAt!: string | null;
}
