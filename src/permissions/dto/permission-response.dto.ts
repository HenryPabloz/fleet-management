import { ApiProperty } from '@nestjs/swagger';

// Um item do catálogo de permissões (tabela permissions).
export class PermissionRespostaDto {
  @ApiProperty({
    description: 'Identificador da permissão (UUID).',
    example: 'f1e2d3c4-b5a6-4978-8899-001122334455',
  })
  id!: string;

  @ApiProperty({ description: 'Código da permissão.', example: 'USER_CREATE' })
  code!: string;

  @ApiProperty({
    description: 'Descrição da permissão.',
    example: 'Permite criar novos usuários.',
    nullable: true,
  })
  description!: string | null;
}

// Visão combinada das permissões de um usuário: as herdadas do papel e as concedidas individualmente.
export class PermissoesDoUsuarioRespostaDto {
  @ApiProperty({
    description: 'Códigos das permissões herdadas do papel (role) do usuário.',
    example: ['TRIP_CREATE', 'TRIP_VIEW'],
    type: [String],
  })
  fromRole!: string[];

  @ApiProperty({
    description: 'Códigos das permissões concedidas individualmente ao usuário (delegação granular).',
    example: ['USER_CREATE'],
    type: [String],
  })
  individual!: string[];
}
