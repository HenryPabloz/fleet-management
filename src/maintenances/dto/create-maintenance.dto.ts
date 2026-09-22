import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIPOS_ACEITOS = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'] as const;
const STATUS_ACEITOS = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;

export class CreateMaintenanceDto {
  // Vínculo fixo com o veículo; precisa existir e não estar soft-deletado.
  @IsUUID()
  vehicleId!: string;

  @IsIn(TIPOS_ACEITOS)
  type!: (typeof TIPOS_ACEITOS)[number];

  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  status?: (typeof STATUS_ACEITOS)[number];

  // IsISO8601 aceita data pura ou com hora, fica mais flexível.
  @IsISO8601()
  scheduledDate!: string;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  cost!: number;
}
