import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const STATUS_ACEITOS = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

// Query de listagem: paginação + filtros opcionais por status, motorista e veículo.
export class ListTripQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  status?: (typeof STATUS_ACEITOS)[number];

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
