import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { DadosMotoristaDto } from './dados-motorista.dto';

// Corpo de PATCH /users/:id/role.
export class TrocarRoleDto {
  @ApiProperty({
    description: 'Identificador do novo papel (UUID). Os IDs reais aparecem em GET /roles.',
    example: 'f1e2d3c4-b5a6-4978-8899-001122334455',
  })
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({
    description:
      'Obrigatório só ao virar DRIVER quando o usuário ainda não tem perfil de motorista. ' +
      'Com outro papel, retorna 400. Se o usuário já tem perfil, o existente é mantido.',
    type: () => DadosMotoristaDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DadosMotoristaDto)
  driver?: DadosMotoristaDto;
}
