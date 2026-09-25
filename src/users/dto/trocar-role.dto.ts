import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// Corpo de PATCH /users/:id/role (só promoção).
export class TrocarRoleDto {
  @ApiProperty({
    description: 'Identificador do novo papel (UUID), que deve ser maior que o atual. Os IDs reais aparecem em GET /roles. Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: '00000000-0000-0000-0000-000000000000',
  })
  @IsUUID()
  roleId!: string;
}
