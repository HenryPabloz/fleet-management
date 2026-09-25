import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConcederPermissionDto {
  @ApiProperty({
    description: 'Código da permissão a conceder individualmente ao usuário (ex: USER_CREATE). Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: 'PERMISSAO_DE_EXEMPLO',
  })
  @IsString()
  @IsNotEmpty()
  permissionCode!: string;
}
