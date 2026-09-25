import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsPositive, IsUUID } from 'class-validator';

const TIPOS_COMBUSTIVEL = ['DIESEL', 'GASOLINE', 'ETHANOL', 'HYBRID'] as const;

// Sem totalCost e sem mileage: a procedure calcula o total e grava o hodômetro atual do veículo.
export class CreateRefuelingDto {
  @IsUUID()
  @ApiProperty({ description: "Id do veículo abastecido (UUID). Veículo fora de serviço é recusado. Exemplo ilustrativo: substitua pelos dados reais antes de executar.", example: "00000000-0000-0000-0000-000000000000" })
  vehicleId!: string;

  @IsUUID()
  @ApiProperty({ description: "Id do motorista (UUID). Precisa estar ativo; se o veículo está em viagem ativa, tem de ser o motorista da viagem. Exemplo ilustrativo: substitua pelos dados reais antes de executar.", example: "00000000-0000-0000-0000-000000000000" })
  driverId!: string;

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
