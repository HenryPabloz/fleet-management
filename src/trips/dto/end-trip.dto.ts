import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class EndTripDto {
  @IsInt()
  @Min(0)
  @ApiProperty({ description: "Hodômetro ao chegar. Não pode ser menor que o `startKm` nem que a quilometragem atual do veículo (máx. 10.000.000). Distância = endMileage - startKm; o veículo passa a ter essa quilometragem e volta a AVAILABLE.", example: 15180 })
  endMileage!: number;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @ApiProperty({ description: "Local de chegada em texto livre (até 255 caracteres; aqui não é CEP).", example: "Campinas, SP" })
  endLocation!: string;
}
