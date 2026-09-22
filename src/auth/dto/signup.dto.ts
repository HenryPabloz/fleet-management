import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  // O banco só aceita e-mail em minúsculas e sem espaços.
  @ApiProperty({
    description: 'E-mail do novo usuário (único).',
    example: 'motorista@fleet.com',
  })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    return value;
  })
  @IsEmail()
  @MaxLength(255)
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

  @ApiProperty({ description: 'Nome completo.', example: 'João da Silva' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName!: string;
}
