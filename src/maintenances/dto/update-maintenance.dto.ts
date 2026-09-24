import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({ description: "Tipo da manutenção.", example: "CORRECTIVE", enum: ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'] })
  type?: (typeof TIPOS_ACEITOS)[number];

  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  @ApiPropertyOptional({ description: "Novo status.", example: "COMPLETED", enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] })
  status?: (typeof STATUS_ACEITOS)[number];

  @IsOptional()
  @IsISO8601()
  @ApiPropertyOptional({ description: "Data agendada (ISO 8601).", example: "2026-10-15" })
  scheduledDate?: string;

  @IsOptional()
  @IsISO8601()
  @ApiPropertyOptional({ description: "Data de conclusão (ISO 8601).", example: "2026-10-16" })
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
  @ApiPropertyOptional({ description: "Descrição do serviço.", example: "Troca de pastilhas de freio" })
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  @ApiPropertyOptional({ description: "Custo em reais.", example: 620 })
  cost?: number;
}
