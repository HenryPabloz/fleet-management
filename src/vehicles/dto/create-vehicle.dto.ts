import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STATUS_VEHICLE_ACEITOS_NA_ESCRITA } from './status-vehicle-escrita.constant';
import type { StatusVehicleEscrita } from './status-vehicle-escrita.constant';

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
}
