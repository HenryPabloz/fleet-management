import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min } from 'class-validator';

// Sem @IsValidCep() por enquanto: a integração com o ViaCEP ainda não foi
// implementada (fica para um passo futuro do guia). Local é string livre.
export class CreateTripDto {
  @IsUUID()
  driverId!: string;

  @IsUUID()
  vehicleId!: string;

  @IsInt()
  @Min(0)
  startKm!: number;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  startLocation!: string;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  endLocation!: string;
}
