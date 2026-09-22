import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// PATCH: userId não entra aqui de propósito, o vínculo é fixo após criado.
export class UpdateDriverDto {
  @ApiPropertyOptional({
    description: 'Número da CNH (único no sistema).',
    example: '12345678900',
    maxLength: 20,
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
  @MaxLength(20)
  @Matches(/^[0-9]{11}$/, {
    message: 'License number must be exactly 11 digits (CNH format)',
  })
  licenseNumber?: string;

  @ApiPropertyOptional({
    description: 'Data de validade da CNH (ISO 8601).',
    example: '2027-08-30',
  })
  @IsOptional()
  @IsISO8601()
  licenseExpiry?: string;

  @ApiPropertyOptional({
    description: 'Se o motorista está ativo.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
