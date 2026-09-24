import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// Corpo de PATCH /users/:id/role (só promoção).
export class TrocarRoleDto {
  @ApiProperty({
    description: 'Identificador do novo papel (UUID), que deve ser maior que o atual. Os IDs reais aparecem em GET /roles.',
    example: 'f1e2d3c4-b5a6-4978-8899-001122334455',
  })
  @IsUUID()
  roleId!: string;
}
