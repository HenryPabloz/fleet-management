import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// PATCH /users/me/password: exige a senha atual antes de trocar.
export class TrocarSenhaDto {
  @ApiProperty({
    description: 'Senha atual do usuário, para confirmar a troca. Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: 'senha-exemplo',
  })
  @IsString()
  currentPassword!: string;

  // Mesma regra de tamanho do cadastro (CreateUserDto/SignupDto).
  @ApiProperty({
    description: 'Nova senha em texto puro (mín. 8, máx. 15 caracteres).',
    example: 'nova-senha-exemplo',
    minLength: 8,
    maxLength: 15,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(15)
  newPassword!: string;
}
