import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// PATCH /users/me: só o próprio nome. E-mail, senha, roleId e isActive não
// entram aqui de propósito — são dados sensíveis/administrativos (ver
// UpdateUserDto, que é a rota do ADMIN).
export class UpdateMeuPerfilDto {
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
}
