import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsValidCnh } from '../../common/validators/is-valid-cnh.validator';

// Bloco `driver` de POST /users (perfil de motorista).
export class DadosMotoristaDto {
  @ApiProperty({
    description: 'Número da CNH (11 dígitos numéricos; único no sistema).',
    example: '00000000000',
    maxLength: 20,
  })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @IsValidCnh()
  licenseNumber!: string;

  @ApiProperty({
    description: 'Data de validade da CNH (ISO 8601). Não pode estar no passado. Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: '2020-01-01',
  })
  @IsISO8601()
  licenseExpiry!: string;
}
