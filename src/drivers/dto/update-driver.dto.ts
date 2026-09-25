import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

// PATCH: só a validade da CNH muda. Número da CNH e isActive não são aceitos.
export class UpdateDriverDto {
  @ApiProperty({
    description: 'Nova data de validade da CNH (ISO 8601). Deve ser uma data futura. Exemplo ilustrativo: substitua pelos dados reais antes de executar.',
    example: '2020-01-01',
  })
  @IsISO8601()
  licenseExpiry!: string;
}
