import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const TIPOS_ACEITOS = ['ACCIDENT', 'MECHANICAL_FAILURE', 'OTHER'] as const;
const SEVERIDADES_ACEITAS = ['LOW', 'MEDIUM', 'HIGH'] as const;

// Sem photoUrl/photoKey aqui: eles vêm do arquivo enviado (multipart), não do
// corpo JSON. O controller monta os 2 campos depois do upload e passa pro service.
export class CreateIncidentDto {
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsUUID()
  vehicleId!: string;

  @IsUUID()
  driverId!: string;

  @IsIn(TIPOS_ACEITOS)
  type!: (typeof TIPOS_ACEITOS)[number];

  @IsIn(SEVERIDADES_ACEITAS)
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
  description!: string;
}
