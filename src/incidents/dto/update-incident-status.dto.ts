import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const STATUS_ACEITOS = ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'] as const;

export class UpdateIncidentStatusDto {
  @IsIn(STATUS_ACEITOS)
  @ApiProperty({ description: "Novo status; só avança: REPORTED -> UNDER_INVESTIGATION -> RESOLVED.", example: "UNDER_INVESTIGATION", enum: ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'] })
  status!: (typeof STATUS_ACEITOS)[number];
}
