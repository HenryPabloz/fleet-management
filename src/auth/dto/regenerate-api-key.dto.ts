import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RegenerateApiKeyDto {
  @ApiProperty({
    description: 'Senha atual do usuário dono da chave (confirma que é ele mesmo). Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: 'senha-exemplo',
    minLength: 8,
    maxLength: 15,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(15)
  password!: string;
}
