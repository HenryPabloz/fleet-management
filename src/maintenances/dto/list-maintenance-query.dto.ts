import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const STATUS_ACEITOS = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;

// Query de listagem: paginação + filtros opcionais por status e veículo.
export class ListMaintenanceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  status?: (typeof STATUS_ACEITOS)[number];

  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
