import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// Os 4 status existem na tabela; IN_USE é bloqueado só na ESCRITA (POST/PATCH/PUT).
// Filtrar por ele na leitura é legítimo (ex: ver quais veículos estão em uso agora).
const STATUS_ACEITOS = [
  'AVAILABLE',
  'IN_USE',
  'IN_MAINTENANCE',
  'OUT_OF_SERVICE',
] as const;

// Query de listagem: paginação + filtro opcional por status.
export class ListVehicleQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(STATUS_ACEITOS)
  status?: (typeof STATUS_ACEITOS)[number];
}
