import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { DadosMotoristaDto } from './dados-motorista.dto';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  // O banco só aceita e-mail em minúsculas e sem espaços.
  @ApiProperty({
    description: 'E-mail do usuário (único). Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: 'pessoa@exemplo.invalid',
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
    example: 'senha-exemplo',
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

  // ADMIN atribui qualquer papel; quem não é ADMIN só cria DRIVER (regra no serviço).
  @ApiProperty({
    description: 'Identificador do papel (role) do usuário (UUID). Os papéis também podem ser listados em GET /roles. ADMIN atribui qualquer papel; os demais só DRIVER. Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: '00000000-0000-0000-0000-000000000000',
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

  @ApiPropertyOptional({
    description:
      'Obrigatório com papel DRIVER (cria o perfil de motorista junto com a conta, na mesma transação). Com outro papel, retorna 400.',
    type: () => DadosMotoristaDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DadosMotoristaDto)
  driver?: DadosMotoristaDto;
}
