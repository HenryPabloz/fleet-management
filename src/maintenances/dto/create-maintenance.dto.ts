import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ description: "Id do veículo (UUID). Precisa existir e não estar removido. Exemplo ilustrativo: substitua pelos dados reais antes de executar.", example: "00000000-0000-0000-0000-000000000000" })
  vehicleId!: string;

  @IsIn(TIPOS_ACEITOS)
  @ApiProperty({ description: "Tipo da manutenção.", example: "PREVENTIVE", enum: ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'] })
  type!: (typeof TIPOS_ACEITOS)[number];

  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  @ApiPropertyOptional({ description: "Status. Padrão: SCHEDULED.", example: "SCHEDULED", enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] })
  status?: (typeof STATUS_ACEITOS)[number];

  // IsISO8601 aceita data pura ou com hora, fica mais flexível.
  @IsISO8601()
  @ApiProperty({ description: "Data agendada (ISO 8601, data ou data e hora).", example: "2026-10-15" })
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
  @ApiProperty({ description: "Descrição do serviço (até 1000 caracteres).", example: "Revisão dos 15.000 km: óleo, filtros e freios" })
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  @ApiProperty({ description: "Custo em reais (até 2 casas decimais).", example: 450.5 })
  cost!: number;
}
