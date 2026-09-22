import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// PUT: substitui todos os campos editáveis, todos obrigatórios.
// userId não entra aqui de propósito, o vínculo é fixo após criado.
export class ReplaceDriverDto {
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
  @Matches(/^[0-9]{11}$/, {
    message: 'License number must be exactly 11 digits (CNH format)',
  })
  licenseNumber!: string;

  @ApiProperty({
    description: 'Data de validade da CNH (ISO 8601).',
    example: '2027-08-30',
  })
  @IsISO8601()
  licenseExpiry!: string;

  @ApiProperty({ description: 'Se o motorista está ativo.', example: true })
  @IsBoolean()
  isActive!: boolean;
}
