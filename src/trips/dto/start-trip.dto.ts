import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class StartTripDto {
  @IsInt()
  @Min(0)
  @ApiProperty({ description: "Leitura real do hodômetro ao sair. Não pode ser menor que a quilometragem atual do veículo (máx. 10.000.000). Vira o `startKm` da viagem e a quilometragem do veículo.", example: 15000 })
  currentMileage!: number;
}
