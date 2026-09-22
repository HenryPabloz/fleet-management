import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SEVERIDADES_ACEITAS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const STATUS_ACEITOS = ['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED'] as const;

// Query de listagem: paginação + filtros opcionais por severidade, status e veículo.
export class ListIncidentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SEVERIDADES_ACEITAS)
  severity?: (typeof SEVERIDADES_ACEITAS)[number];

  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  status?: (typeof STATUS_ACEITOS)[number];

  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
