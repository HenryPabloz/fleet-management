import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// PUT: substitui todos os campos editáveis, todos obrigatórios. A role só muda por PATCH /users/:id/role.
// E-mail e senha não entram aqui de propósito (fluxo próprio, fora de escopo agora).
export class ReplaceUserDto {
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

  @ApiProperty({ description: 'Se o usuário está ativo.', example: true })
  @IsBoolean()
  isActive!: boolean;
}
