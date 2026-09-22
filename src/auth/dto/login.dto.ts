import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  // Tira espaços das pontas antes de validar, senão " a@b.com" seria recusado.
  @ApiProperty({
    description: 'E-mail cadastrado.',
    example: 'motorista@fleet.com',
  })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsEmail()
  email!: string;

  // Limite de 15 caracteres por decisão do projeto (senha curta, fácil de digitar).
  @ApiProperty({
    description: 'Senha em texto puro (mín. 8, máx. 15 caracteres).',
    example: 'SenhaForte123',
    minLength: 8,
    maxLength: 15,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(15)
  password!: string;
}
