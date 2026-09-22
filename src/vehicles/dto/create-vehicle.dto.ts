import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STATUS_VEHICLE_ACEITOS_NA_ESCRITA } from './status-vehicle-escrita.constant';
import type { StatusVehicleEscrita } from './status-vehicle-escrita.constant';
import { IsValidCep } from '../../common/validators/is-valid-cep.validator';

export class CreateVehicleDto {
  // O CHECK do banco exige maiúsculo/trim; validamos aqui também para dar erro claro.
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim().toUpperCase();
    }
    return value;
  })
  @IsString()
  @Length(7, 8)
  @Matches(/^([A-Z]{3}[0-9][A-Z][0-9]{2}|[A-Z]{3}-?[0-9]{4})$/, {
    message:
      'Plate must be in Mercosul format (ABC1D23) or the old format (ABC1234 or ABC-1234)',
  })
  plate!: string;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model!: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsIn(STATUS_VEHICLE_ACEITOS_NA_ESCRITA)
  status?: StatusVehicleEscrita;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  currentMileage?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  lastMaintenanceKm?: number;

  // Opcional: se vier, é validado contra a API real do ViaCEP e devolvido
  // enriquecido na resposta (initialLocation), mas NÃO é persistido no banco.
  @ApiPropertyOptional({
    description:
      'CEP brasileiro (com ou sem máscara) da localização inicial do veículo. Se enviado, é ' +
      'validado contra a API real do ViaCEP e o endereço resolvido volta no campo ' +
      '`initialLocation` da resposta — não é persistido no banco (não existe coluna para isso ' +
      'em `vehicles`).',
    example: '01310-100',
  })
  @IsOptional()
  @IsString()
  @IsValidCep()
  initialLocationCep?: string;
}
