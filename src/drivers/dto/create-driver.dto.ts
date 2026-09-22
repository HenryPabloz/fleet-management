import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateDriverDto {
  // Vincula a um User já existente; um user só pode ter 1 driver.
  @ApiProperty({
    description: 'Identificador do usuário a vincular como motorista (UUID). O usuário precisa existir e ainda não ter um motorista.',
    example: 'b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    description: 'Número da CNH (único no sistema).',
    example: '12345678900',
    maxLength: 20,
  })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  licenseNumber!: string;

  // IsISO8601 (em vez de IsDateString) porque aceita data pura ("2026-01-01")
  // e data com hora, ficando mais flexível para quem chama a API.
  @ApiProperty({
    description: 'Data de validade da CNH (ISO 8601). Não pode estar no passado.',
    example: '2027-08-30',
  })
  @IsISO8601()
  licenseExpiry!: string;

  @ApiPropertyOptional({
    description: 'Se o motorista já entra ativo. Padrão: true.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
