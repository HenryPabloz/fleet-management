import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIPOS_ACEITOS = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'] as const;
const STATUS_ACEITOS = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;

// PATCH: vehicleId não entra aqui de propósito, o vínculo é fixo após criado.
export class UpdateMaintenanceDto {
  @IsOptional()
  @IsIn(TIPOS_ACEITOS)
  type?: (typeof TIPOS_ACEITOS)[number];

  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  status?: (typeof STATUS_ACEITOS)[number];

  @IsOptional()
  @IsISO8601()
  scheduledDate?: string;

  @IsOptional()
  @IsISO8601()
  completedDate?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  cost?: number;
}
