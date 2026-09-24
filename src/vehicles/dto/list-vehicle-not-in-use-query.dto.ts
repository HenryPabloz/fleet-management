import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// Query de "fora de uso": paginação + filtro opcional só pelos status diferentes de IN_USE.
export class ListVehicleNotInUseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['AVAILABLE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE'])
  status?: 'AVAILABLE' | 'IN_MAINTENANCE' | 'OUT_OF_SERVICE';
}
