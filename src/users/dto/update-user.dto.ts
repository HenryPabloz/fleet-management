import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// PATCH: todo campo é opcional. A role NÃO muda aqui: só por PATCH /users/:id/role. E-mail e senha não entram aqui de propósito
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

  @ApiPropertyOptional({ description: 'Se o usuário está ativo.', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
