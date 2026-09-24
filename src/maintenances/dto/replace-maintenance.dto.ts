import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ description: "Tipo da manutenção.", example: "PREVENTIVE", enum: ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'] })
  type!: (typeof TIPOS_ACEITOS)[number];

  @IsIn(STATUS_ACEITOS)
  @ApiProperty({ description: "Status.", example: "COMPLETED", enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] })
  status!: (typeof STATUS_ACEITOS)[number];

  @IsISO8601()
  @ApiProperty({ description: "Data agendada (ISO 8601).", example: "2026-10-15" })
  scheduledDate!: string;

  @IsOptional()
  @IsISO8601()
  @ApiPropertyOptional({ description: "Data de conclusão (ISO 8601); só faz sentido quando termina.", example: "2026-10-16" })
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
  @ApiProperty({ description: "Descrição do serviço.", example: "Revisão completa concluída" })
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  @ApiProperty({ description: "Custo em reais.", example: 780.9 })
  cost!: number;
}
