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

// PUT: substitui todos os campos editáveis. completedDate fica opcional
// (só existe depois que a manutenção termina). vehicleId não entra aqui,
// o vínculo é fixo após criado.
export class ReplaceMaintenanceDto {
  @IsIn(TIPOS_ACEITOS)
  type!: (typeof TIPOS_ACEITOS)[number];

  @IsIn(STATUS_ACEITOS)
  status!: (typeof STATUS_ACEITOS)[number];

  @IsISO8601()
  scheduledDate!: string;

  @IsOptional()
  @IsISO8601()
  completedDate?: string;

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
