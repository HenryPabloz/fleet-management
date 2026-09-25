import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STATUS_VEHICLE_ACEITOS_NA_ESCRITA } from './status-vehicle-escrita.constant';
import type { StatusVehicleEscrita } from './status-vehicle-escrita.constant';
import { IsValidCep } from '../../common/validators/is-valid-cep.validator';
import { IsValidPlaca } from '../../common/validators/is-valid-placa.validator';

export class CreateVehicleDto {
  // O CHECK do banco exige maiúsculo/trim; validamos aqui também para dar erro claro.
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim().toUpperCase();
    }
    return value;
  })
  @IsString()
  @Length(7, 8)
  @IsValidPlaca()
  @ApiProperty({ description: "Placa (padrão antigo ABC1234 ou Mercosul ABC1D23). Única; não muda depois de criada. Exemplo ilustrativo: substitua pelos dados reais antes de executar.", example: "AAA-0000" })
  plate!: string;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({ description: "Modelo do veículo.", example: "Fiat Strada" })
  model!: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  @ApiProperty({ description: "Ano de fabricação (1900 a 2100).", example: 2022 })
  year!: number;

  @IsOptional()
  @IsIn(STATUS_VEHICLE_ACEITOS_NA_ESCRITA)
  @ApiPropertyOptional({ description: "Status inicial. `IN_USE` nunca é aceito pela API (só as viagens colocam o veículo em uso). Padrão: AVAILABLE.", example: "AVAILABLE", enum: ['AVAILABLE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE'] })
  status?: StatusVehicleEscrita;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  @ApiPropertyOptional({ description: "Quilometragem atual (hodômetro), 0 a 10.000.000. Padrão: 0.", example: 15000 })
  currentMileage?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  @ApiPropertyOptional({ description: "Quilometragem da última manutenção, 0 a 10.000.000. Padrão: 0.", example: 10000 })
  lastMaintenanceKm?: number;

  // Opcional: se vier, é validado contra a API real do ViaCEP e devolvido
  // enriquecido na resposta (initialLocation), mas NÃO é persistido no banco.
  @ApiPropertyOptional({
    description:
      'CEP brasileiro (com ou sem máscara) da localização inicial do veículo. Se enviado, é ' +
      'validado contra a API real do ViaCEP e o endereço resolvido volta no campo ' +
      '`initialLocation` da resposta — não é persistido no banco (não existe coluna para isso ' +
      'em `vehicles`). O exemplo `00000-000` é fictício: use um CEP real. Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: '00000-000',
  })
  @IsOptional()
  @IsString()
  @IsValidCep()
  initialLocationCep?: string;
}
