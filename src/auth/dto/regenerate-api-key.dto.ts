import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RegenerateApiKeyDto {
  @ApiProperty({
    description: 'Senha atual do usuário dono da chave (confirma que é ele mesmo).',
    example: 'SenhaForte123',
    minLength: 8,
    maxLength: 15,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(15)
  password!: string;
}
