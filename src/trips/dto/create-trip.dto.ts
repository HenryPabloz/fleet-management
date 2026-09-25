import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsValidCep } from '../../common/validators/is-valid-cep.validator';

// startLocation/endLocation passam a exigir um CEP brasileiro real (validado
// contra a API do ViaCEP). O texto gravado no banco não é o CEP em si, e sim
// o endereço resolvido (ex: "São Paulo, SP") — ver TripsService.criar.
export class CreateTripDto {
  @ApiProperty({
    description: 'Id do motorista que vai fazer a viagem (UUID). Precisa estar ativo e com CNH válida.' +
      ' Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: '00000000-0000-0000-0000-000000000000',
  })
  @IsUUID()
  driverId!: string;

  @ApiProperty({
    description: 'Id do veículo a usar na viagem (UUID). Precisa estar `AVAILABLE`.' +
      ' Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: '00000000-0000-0000-0000-000000000000',
  })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({
    description:
      'CEP brasileiro (com ou sem máscara) do ponto de partida. Precisa ser um CEP válido, ' +
      'confirmado contra a API real do ViaCEP — não aceita mais texto livre. O que é gravado no ' +
      'banco é o endereço resolvido (ex: "São Paulo, SP"), não o CEP em si. O exemplo `00000-000` é fictício: use um CEP real.',
    example: '00000-000',
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
      'endereço resolvido (ex: "Campinas, SP"), não o CEP em si. O exemplo `00000-000` é fictício: use um CEP real.',
    example: '00000-000',
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
