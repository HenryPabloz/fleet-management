import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  // O banco só aceita e-mail em minúsculas e sem espaços.
  @ApiProperty({
    description: 'E-mail do usuário (único).',
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

  // Só o ADMIN escolhe o papel; o /auth/signup público sempre cria DRIVER.
  @ApiProperty({
    description: 'Identificador do papel (role) do usuário (UUID).',
    example: 'f1e2d3c4-b5a6-4978-8899-001122334455',
  })
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({
    description: 'Se o usuário já entra ativo. Padrão: true.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
