import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const TIPOS_ACEITOS = ['ACCIDENT', 'MECHANICAL_FAILURE', 'OTHER'] as const;
const SEVERIDADES_ACEITAS = ['LOW', 'MEDIUM', 'HIGH'] as const;

// Sem photoUrl/photoKey aqui: eles vêm do arquivo enviado (multipart), não do
// corpo JSON. O controller monta os 2 campos depois do upload e passa pro service.
export class CreateIncidentDto {
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ description: "Viagem relacionada (UUID). Opcional: o incidente pode ocorrer fora de viagem. Se informado, a viagem precisa estar IN_PROGRESS e ser do mesmo veículo e motorista.", example: "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f" })
  tripId?: string;

  @IsUUID()
  @ApiProperty({ description: "Id do veículo (UUID). Fora de serviço é recusado.", example: "9f8e7d6c-5b4a-4c2d-8e0f-a1b2c3d4e5f6" })
  vehicleId!: string;

  @IsUUID()
  @ApiProperty({ description: "Id do motorista (UUID). Precisa estar ativo.", example: "b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f" })
  driverId!: string;

  @IsIn(TIPOS_ACEITOS)
  @ApiProperty({ description: "Tipo do incidente.", example: "MECHANICAL_FAILURE", enum: ['ACCIDENT', 'MECHANICAL_FAILURE', 'OTHER'] })
  type!: (typeof TIPOS_ACEITOS)[number];

  @IsIn(SEVERIDADES_ACEITAS)
  @ApiProperty({ description: "Gravidade.", example: "MEDIUM", enum: ['LOW', 'MEDIUM', 'HIGH'] })
  severity!: (typeof SEVERIDADES_ACEITAS)[number];

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @ApiProperty({ description: "Descrição (até 1000 caracteres).", example: "Pane no motor durante a viagem" })
  description!: string;
}
