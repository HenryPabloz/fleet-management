import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConcederPermissionDto {
  @ApiProperty({
    description: 'Código da permissão a conceder individualmente ao usuário (ex: USER_CREATE).',
    example: 'USER_CREATE',
  })
  @IsString()
  @IsNotEmpty()
  permissionCode!: string;
}
