import { IsIn } from 'class-validator';

const STATUS_ACEITOS = ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'] as const;

export class UpdateIncidentStatusDto {
  @IsIn(STATUS_ACEITOS)
  status!: (typeof STATUS_ACEITOS)[number];
}
