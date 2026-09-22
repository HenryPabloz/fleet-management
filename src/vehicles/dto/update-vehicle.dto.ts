import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { STATUS_VEHICLE_ACEITOS_NA_ESCRITA } from './status-vehicle-escrita.constant';
import type { StatusVehicleEscrita } from './status-vehicle-escrita.constant';

// PATCH: plate não entra aqui de propósito, a placa não muda depois de criada.
export class UpdateVehicleDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

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
}
