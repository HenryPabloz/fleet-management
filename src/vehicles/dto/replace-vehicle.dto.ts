import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ description: "Modelo do veículo.", example: "Fiat Strada" })
  model!: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  @ApiProperty({ description: "Ano de fabricação (1900 a 2100).", example: 2022 })
  year!: number;

  @IsIn(STATUS_VEHICLE_ACEITOS_NA_ESCRITA)
  @ApiProperty({ description: "Status do veículo. `IN_USE` nunca é aceito pela API.", example: "AVAILABLE", enum: ['AVAILABLE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE'] })
  status!: StatusVehicleEscrita;

  @IsInt()
  @Min(0)
  @Max(10000000)
  @ApiProperty({ description: "Quilometragem atual; não pode ser menor que a atual do veículo.", example: 16000 })
  currentMileage!: number;

  @IsInt()
  @Min(0)
  @Max(10000000)
  @ApiProperty({ description: "Quilometragem da última manutenção.", example: 15000 })
  lastMaintenanceKm!: number;
}
