import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export class EndTripDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  @ApiProperty({ description: "Quilômetros RODADOS na viagem (1 a 100.000). Não é leitura de hodômetro: o servidor soma esse valor ao hodômetro do veículo. O motorista informa a distância real, que pode diferir da estimada. Exemplo ilustrativo: substitua pelos dados reais antes de executar.", example: 120 })
  endKm!: number;

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
