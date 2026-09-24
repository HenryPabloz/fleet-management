import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

// PUT: substitui todos os campos editáveis, todos obrigatórios.
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

  @ApiProperty({
    description: 'Identificador do papel (role) do usuário (UUID). Os papéis também podem ser listados em GET /roles.',
    example: 'f1e2d3c4-b5a6-4978-8899-001122334455',
  })
  @IsUUID()
  roleId!: string;

  @ApiProperty({ description: 'Se o usuário está ativo.', example: true })
  @IsBoolean()
  isActive!: boolean;
}
