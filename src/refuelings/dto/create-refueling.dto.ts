import { IsIn, IsInt, IsNumber, IsPositive, IsUUID, Min } from 'class-validator';

const TIPOS_COMBUSTIVEL = ['DIESEL', 'GASOLINE', 'ETHANOL', 'HYBRID'] as const;

// Sem totalCost: a procedure register_refueling calcula (litros x preço, arredondado).
export class CreateRefuelingDto {
  @IsUUID()
  vehicleId!: string;

  @IsUUID()
  driverId!: string;

  @IsInt()
  @Min(1)
  mileage!: number;

  @IsNumber()
  @IsPositive()
  litersAdded!: number;

  @IsNumber()
  @IsPositive()
  costPerLiter!: number;

  @IsIn(TIPOS_COMBUSTIVEL)
  fuelType!: (typeof TIPOS_COMBUSTIVEL)[number];
}
