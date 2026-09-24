import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

// PATCH: só a validade da CNH muda. Número da CNH e isActive não são aceitos.
export class UpdateDriverDto {
  @ApiProperty({
    description: 'Nova data de validade da CNH (ISO 8601). Deve ser uma data futura.',
    example: '2030-08-30',
  })
  @IsISO8601()
  licenseExpiry!: string;
}
