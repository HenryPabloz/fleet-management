import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginacaoMetadataDto } from '../common/swagger/pagination-response.schema';
import { ErroPadraoDto } from '../common/swagger/erro-padrao.schema';
import { CreateDriverDto } from './dto/create-driver.dto';
import { DriverRespostaDto } from './dto/driver-response.dto';
import { ReplaceDriverDto } from './dto/replace-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { DriversService } from './drivers.service';

// Query de paginação comum às duas rotas de listagem (GET / e GET /deleted/all).
const QUERY_PAGE = {
  name: 'page',
  required: false,
  type: Number,
  description: 'Número da página (começa em 1). Padrão: 1.',
  example: 1,
};
const QUERY_PAGE_SIZE = {
  name: 'pageSize',
  required: false,
  type: Number,
  description: 'Itens por página (1 a 100). Padrão: 20.',
  example: 20,
};

// Leitura: ADMIN e FLEET_MANAGER. Escrita: só ADMIN (o gestor de frota não
// cadastra/edita motorista diretamente; se precisar, é uma decisão de negócio
// separada, fora do escopo deste resource).
@ApiTags('drivers')
@ApiBearerAuth('jwt')
@ApiExtraModels(ErroPadraoDto, PaginacaoMetadataDto, DriverRespostaDto)
@Controller('drivers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DriversController {
  constructor(private servicoDrivers: DriversService) {}

  @Get()
  @Roles('ADMIN', 'FLEET_MANAGER')
  @ApiOperation({
    summary: 'Lista motoristas (paginado)',
    description:
      'Lista motoristas ativos (não removidos), paginado. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `drivers`.',
    ...({ 'x-database-tables': { read: ['drivers'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de motoristas.',
    schema: {
      allOf: [
        {
          properties: {
            data: { type: 'array', items: { $ref: getSchemaPath(DriverRespostaDto) } },
          },
        },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  listar(@Query() paginacao: PaginationQueryDto) {
    return this.servicoDrivers.listar(paginacao.page, paginacao.pageSize);
  }

  // Precisa vir antes de "GET /:id", senão "deleted" seria lido como um id.
  @Get('deleted/all')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Lista motoristas removidos (soft delete), paginado',
    description:
      'Lista motoristas já removidos logicamente (deletedAt preenchido), paginado. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `drivers`.',
    ...({ 'x-database-tables': { read: ['drivers'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de motoristas removidos.',
    schema: {
      allOf: [
        {
          properties: {
            data: { type: 'array', items: { $ref: getSchemaPath(DriverRespostaDto) } },
          },
        },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  listarRemovidos(@Query() paginacao: PaginationQueryDto) {
    return this.servicoDrivers.listarRemovidos(
      paginacao.page,
      paginacao.pageSize,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'FLEET_MANAGER')
  @ApiOperation({
    summary: 'Busca um motorista por id',
    description:
      'Busca um motorista ativo pelo id. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `drivers`.',
    ...({ 'x-database-tables': { read: ['drivers'] } } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do motorista (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Motorista encontrado.', type: DriverRespostaDto })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Motorista não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoDrivers.buscarPorId(id);
  }

  @Post()
  @Roles('ADMIN')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Cria um motorista',
    description:
      'Vincula um `User` já existente (não removido) como motorista. Um usuário só pode ter ' +
      'um motorista, e o número da CNH é único. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `users` (valida userId), `drivers` (checa vínculo e CNH duplicados); escreve em `drivers`.',
    ...({
      'x-database-tables': { read: ['users', 'drivers'], write: ['drivers'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: CreateDriverDto })
  @ApiResponse({ status: 201, description: 'Motorista criado.', type: DriverRespostaDto })
  @ApiResponse({
    status: 400,
    description: '`userId` inexistente (ou removido), `licenseExpiry` no passado, ou corpo inválido.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({
    status: 409,
    description: 'O usuário já tem motorista, ou o número da CNH já está cadastrado.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  criar(@Body() dados: CreateDriverDto) {
    return this.servicoDrivers.criar(dados);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atualiza parcialmente um motorista',
    description:
      'Atualiza só os campos enviados (licenseNumber, licenseExpiry, isActive). `userId` não ' +
      'entra aqui, o vínculo é fixo após criado. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `drivers`; escreve em `drivers`.',
    ...({
      'x-database-tables': { read: ['drivers'], write: ['drivers'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do motorista (UUID).', format: 'uuid' })
  @ApiBody({ type: UpdateDriverDto })
  @ApiResponse({ status: 200, description: 'Motorista atualizado.', type: DriverRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Motorista não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 409, description: 'Número da CNH já cadastrado para outro motorista.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  atualizarParcial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: UpdateDriverDto,
  ) {
    return this.servicoDrivers.atualizarParcial(id, dados);
  }

  @Put(':id')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Substitui um motorista',
    description:
      'Substitui todos os campos editáveis (licenseNumber, licenseExpiry, isActive são ' +
      'obrigatórios). `userId` não entra aqui, o vínculo é fixo após criado. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `drivers`; escreve em `drivers`.',
    ...({
      'x-database-tables': { read: ['drivers'], write: ['drivers'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do motorista (UUID).', format: 'uuid' })
  @ApiBody({ type: ReplaceDriverDto })
  @ApiResponse({ status: 200, description: 'Motorista substituído.', type: DriverRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Motorista não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 409, description: 'Número da CNH já cadastrado para outro motorista.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  substituir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: ReplaceDriverDto,
  ) {
    return this.servicoDrivers.substituir(id, dados);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um motorista (soft delete)',
    description:
      'Marca `deletedAt` no motorista; a linha continua no banco e pode ser restaurada em ' +
      '`PATCH /drivers/:id/restore`. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `drivers`; escreve em `drivers`.',
    ...({
      'x-database-tables': { read: ['drivers'], write: ['drivers'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do motorista (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Motorista removido (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Motorista não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  async remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoDrivers.remover(id);
  }

  @Patch(':id/restore')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaura um motorista removido',
    description:
      'Limpa `deletedAt`, revertendo o soft delete. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `drivers`; escreve em `drivers`.',
    ...({
      'x-database-tables': { read: ['drivers'], write: ['drivers'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do motorista (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Motorista restaurado.', type: DriverRespostaDto })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Motorista não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  restaurar(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoDrivers.restaurar(id);
  }

  // Irreversível: apaga a linha de verdade do banco (hard delete).
  @Delete(':id/permanent')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um motorista permanentemente (hard delete)',
    description:
      'Apaga a linha de verdade do banco — irreversível, diferente do `DELETE /drivers/:id` ' +
      '(soft delete). Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `drivers`; escreve (apaga) em `drivers`.',
    ...({
      'x-database-tables': { read: ['drivers'], write: ['drivers'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do motorista (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Motorista apagado definitivamente (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Motorista não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  async removerPermanentemente(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.servicoDrivers.removerPermanentemente(id);
  }
}
