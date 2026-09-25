import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({ description: "Modelo do veículo.", example: "Fiat Strada" })
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  @ApiPropertyOptional({ description: "Ano de fabricação (1900 a 2100).", example: 2022 })
  year?: number;

  @IsOptional()
  @IsIn(STATUS_VEHICLE_ACEITOS_NA_ESCRITA)
  @ApiPropertyOptional({ description: "Novo status. `IN_USE` nunca é aceito pela API.", example: "IN_MAINTENANCE", enum: ['AVAILABLE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE'] })
  status?: StatusVehicleEscrita;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  @ApiPropertyOptional({ description: "Nova quilometragem atual (hodômetro); não pode ser menor que a atual. Só é aceita se o veículo NÃO estiver IN_USE (409 se estiver).", example: 16000 })
  currentMileage?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  @ApiPropertyOptional({ description: "Quilometragem da última manutenção.", example: 15000 })
  lastMaintenanceKm?: number;
}
