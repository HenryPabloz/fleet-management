import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { STATUS_VEHICLE_ACEITOS_NA_ESCRITA } from './status-vehicle-escrita.constant';
import type { StatusVehicleEscrita } from './status-vehicle-escrita.constant';

// PUT: substitui todos os campos editáveis, todos obrigatórios.
// plate não entra aqui de propósito, a placa não muda depois de criada.
export class ReplaceVehicleDto {
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

  @IsIn(STATUS_VEHICLE_ACEITOS_NA_ESCRITA)
  status!: StatusVehicleEscrita;

  @IsInt()
  @Min(0)
  @Max(10000000)
  currentMileage!: number;

  @IsInt()
  @Min(0)
  @Max(10000000)
  lastMaintenanceKm!: number;
}
