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

  // O bcrypt trunca a senha em 72 bytes; sem limite superior, um payload gigante desperdiça CPU no compare.
  @ApiProperty({
    description: 'Senha em texto puro (mín. 8, máx. 72 caracteres).',
    example: 'SenhaForte123',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
