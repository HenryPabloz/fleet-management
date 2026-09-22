import { IsIn, IsOptional } from 'class-validator';

const STATUS_ACEITOS = ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'] as const;

// Query de GET /analytics/incidents/severity: ?status=REPORTED (opcional, filtra antes de agrupar).
export class IncidentsSeverityQueryDto {
  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  status?: (typeof STATUS_ACEITOS)[number];
}
