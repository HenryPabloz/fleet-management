import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsPositive, IsUUID, Min } from 'class-validator';

const TIPOS_COMBUSTIVEL = ['DIESEL', 'GASOLINE', 'ETHANOL', 'HYBRID'] as const;

// Sem totalCost: a procedure register_refueling calcula (litros x preço, arredondado).
export class CreateRefuelingDto {
  @IsUUID()
  @ApiProperty({ description: "Id do veículo abastecido (UUID). Veículo fora de serviço é recusado.", example: "9f8e7d6c-5b4a-4c2d-8e0f-a1b2c3d4e5f6" })
  vehicleId!: string;

  @IsUUID()
  @ApiProperty({ description: "Id do motorista (UUID). Precisa estar ativo; se o veículo está em viagem ativa, tem de ser o motorista da viagem.", example: "b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f" })
  driverId!: string;

  @IsInt()
  @Min(1)
  @ApiProperty({ description: "Hodômetro no abastecimento (> 0, até 10.000.000, não menor que a quilometragem atual do veículo). O veículo passa a ter essa quilometragem.", example: 15420 })
  mileage!: number;

  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: "Litros abastecidos (> 0; arredondado a 2 casas).", example: 42.5 })
  litersAdded!: number;

  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: "Preço por litro (> 0; arredondado a 4 casas). O servidor calcula `totalCost = round(litros x preço, 2)`.", example: 5.89 })
  costPerLiter!: number;

  @IsIn(TIPOS_COMBUSTIVEL)
  @ApiProperty({ description: "Tipo de combustível.", example: "GASOLINE", enum: ['DIESEL', 'GASOLINE', 'ETHANOL', 'HYBRID'] })
  fuelType!: (typeof TIPOS_COMBUSTIVEL)[number];
}
