import { ApiProperty } from '@nestjs/swagger';

// Um papel (tabela roles): só o que o formulário de usuário precisa.
export class RoleRespostaDto {
  @ApiProperty({
    description: 'Identificador do papel (UUID). É o valor usado em `roleId` nas rotas de usuários.',
    example: 'f1e2d3c4-b5a6-4978-8899-001122334455',
  })
  id!: string;

  @ApiProperty({ description: 'Nome do papel.', example: 'FLEET_MANAGER' })
  name!: string;

  @ApiProperty({
    description: 'Descrição do papel.',
    example: 'Gerencia a frota.',
    nullable: true,
  })
  description!: string | null;
}
