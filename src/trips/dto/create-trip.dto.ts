import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { IsValidCep } from '../../common/validators/is-valid-cep.validator';

// startLocation/endLocation passam a exigir um CEP brasileiro real (validado
// contra a API do ViaCEP). O texto gravado no banco não é o CEP em si, e sim
// o endereço resolvido (ex: "São Paulo, SP") — ver TripsService.criar.
export class CreateTripDto {
  @ApiProperty({
    description: 'Id do motorista que vai fazer a viagem (UUID). Precisa estar ativo e com CNH válida.',
    example: 'b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f',
  })
  @IsUUID()
  driverId!: string;

  @ApiProperty({
    description: 'Id do veículo a usar na viagem (UUID). Precisa estar `AVAILABLE`.',
    example: '9f8e7d6c-5b4a-3c2d-1e0f-a1b2c3d4e5f6',
  })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({
    description: 'Quilometragem do veículo no início da viagem.',
    example: 15000,
  })
  @IsInt()
  @Min(0)
  startKm!: number;

  @ApiProperty({
    description:
      'CEP brasileiro (com ou sem máscara) do ponto de partida. Precisa ser um CEP válido, ' +
      'confirmado contra a API real do ViaCEP — não aceita mais texto livre. O que é gravado no ' +
      'banco é o endereço resolvido (ex: "São Paulo, SP"), não o CEP em si.',
    example: '01310-100',
  })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsValidCep()
  startLocation!: string;

  @ApiProperty({
    description:
      'CEP brasileiro (com ou sem máscara) do destino. Mesma regra do `startLocation`: precisa ' +
      'ser um CEP válido confirmado contra a API real do ViaCEP, e o que é gravado no banco é o ' +
      'endereço resolvido (ex: "Campinas, SP"), não o CEP em si.',
    example: '13010-141',
  })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsValidCep()
  endLocation!: string;
}
