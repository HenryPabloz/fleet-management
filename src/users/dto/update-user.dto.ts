import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// PATCH: todo campo é opcional. E-mail e senha não entram aqui de propósito
// (mudar e-mail/senha merece um fluxo próprio, fora de escopo agora).
export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'Nome completo.',
    example: 'João da Silva',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Identificador do papel (role) do usuário (UUID). Os papéis também podem ser listados em GET /roles.',
    example: 'f1e2d3c4-b5a6-4978-8899-001122334455',
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Se o usuário está ativo.', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
