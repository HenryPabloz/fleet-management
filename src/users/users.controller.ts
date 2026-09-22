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
import { Permissions } from '../auth/decorators/permissions.decorator';
import { NomePipe } from '../common/pipes/name-pipe';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginacaoMetadataDto } from '../common/swagger/pagination-response.schema';
import { ErroPadraoDto } from '../common/swagger/erro-padrao.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { ReplaceUserDto } from './dto/replace-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRemovidoRespostaDto, UserRespostaDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

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

@ApiTags('users')
@ApiBearerAuth('jwt')
@ApiExtraModels(ErroPadraoDto, PaginacaoMetadataDto, UserRespostaDto, UserRemovidoRespostaDto)
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private servicoUsers: UsersService) {}

  @Get()
  @Roles('ADMIN', 'FLEET_MANAGER')
  @ApiOperation({
    summary: 'Lista usuários (paginado)',
    description:
      'Lista usuários ativos (não removidos), paginado. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `users`.',
    ...({ 'x-database-tables': { read: ['users'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de usuários.',
    schema: {
      allOf: [
        {
          properties: {
            data: { type: 'array', items: { $ref: getSchemaPath(UserRespostaDto) } },
          },
        },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  listar(@Query() paginacao: PaginationQueryDto) {
    return this.servicoUsers.listar(paginacao.page, paginacao.pageSize);
  }

  // Precisa vir antes de "GET /:id", senão "deleted" seria lido como um id.
  @Get('deleted/all')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Lista usuários removidos (soft delete), paginado',
    description:
      'Lista usuários já removidos logicamente (deletedAt preenchido), paginado. Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `users`.',
    ...({ 'x-database-tables': { read: ['users'] } } as Record<string, unknown>),
  })
  @ApiQuery(QUERY_PAGE)
  @ApiQuery(QUERY_PAGE_SIZE)
  @ApiResponse({
    status: 200,
    description: 'Página de usuários removidos.',
    schema: {
      allOf: [
        {
          properties: {
            data: { type: 'array', items: { $ref: getSchemaPath(UserRemovidoRespostaDto) } },
          },
        },
        { properties: { pagination: { $ref: getSchemaPath(PaginacaoMetadataDto) } } },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  listarRemovidos(@Query() paginacao: PaginationQueryDto) {
    return this.servicoUsers.listarRemovidos(
      paginacao.page,
      paginacao.pageSize,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'FLEET_MANAGER')
  @ApiOperation({
    summary: 'Busca um usuário por id',
    description:
      'Busca um usuário ativo pelo id. Acesso: ADMIN, FLEET_MANAGER.\n\n' +
      '`x-database-tables`: lê `users`.',
    ...({ 'x-database-tables': { read: ['users'] } } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Usuário encontrado.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoUsers.buscarPorId(id);
  }

  @Post()
  @Permissions('USER_CREATE')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Cria um usuário',
    description:
      'Cria um usuário com o papel (`roleId`) informado. Acesso: quem tiver a permissão `USER_CREATE` ' +
      '(ADMIN tem por papel; outros papéis podem receber via delegação granular em `POST /users/:id/permissions`).\n\n' +
      '`x-database-tables`: lê `users` (checa e-mail duplicado), `roles` (valida roleId); escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users', 'roles'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'Usuário criado.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido ou `roleId` inexistente.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  criar(
    @Body() dados: CreateUserDto,
    // Roda separado só pela validação; os dados de verdade vêm de dados.
    @Body('fullName', NomePipe) _fullName: string,
  ) {
    return this.servicoUsers.criar(dados);
  }

  @Patch(':id')
  @Permissions('USER_UPDATE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atualiza parcialmente um usuário',
    description:
      'Atualiza só os campos enviados (fullName, roleId, isActive). E-mail e senha não entram aqui. ' +
      'Acesso: quem tiver a permissão `USER_UPDATE` (ADMIN tem por papel; outros papéis podem receber via delegação granular).\n\n' +
      '`x-database-tables`: lê `users`, `roles` (se `roleId` vier); escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users', 'roles'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'Usuário atualizado.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido ou `roleId` inexistente.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  atualizarParcial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: UpdateUserDto,
    // fullName é opcional no PATCH; o NomePipe deixa passar quando não vem.
    @Body('fullName', NomePipe) _fullName: string | undefined,
  ) {
    return this.servicoUsers.atualizarParcial(id, dados);
  }

  @Put(':id')
  @Permissions('USER_UPDATE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Substitui um usuário',
    description:
      'Substitui todos os campos editáveis (fullName, roleId, isActive são obrigatórios). ' +
      'E-mail e senha não entram aqui. Acesso: quem tiver a permissão `USER_UPDATE` (ADMIN tem por papel; ' +
      'outros papéis podem receber via delegação granular).\n\n' +
      '`x-database-tables`: lê `users`, `roles`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users', 'roles'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiBody({ type: ReplaceUserDto })
  @ApiResponse({ status: 200, description: 'Usuário substituído.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido ou `roleId` inexistente.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  substituir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: ReplaceUserDto,
    // Roda separado só pela validação; os dados de verdade vêm de dados.
    @Body('fullName', NomePipe) _fullName: string,
  ) {
    return this.servicoUsers.substituir(id, dados);
  }

  @Delete(':id')
  @Permissions('USER_DELETE')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um usuário (soft delete)',
    description:
      'Marca `deletedAt` no usuário; a linha continua no banco e pode ser restaurada ' +
      'em `PATCH /users/:id/restore`. Acesso: quem tiver a permissão `USER_DELETE` (ADMIN tem por papel; ' +
      'outros papéis podem receber via delegação granular).\n\n' +
      '`x-database-tables`: lê `users`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Usuário removido (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  async remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicoUsers.remover(id);
  }

  @Patch(':id/restore')
  @Permissions('USER_DELETE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaura um usuário removido',
    description:
      'Limpa `deletedAt`, revertendo o soft delete. Acesso: quem tiver a permissão `USER_DELETE` ' +
      '(ADMIN tem por papel; outros papéis podem receber via delegação granular).\n\n' +
      '`x-database-tables`: lê `users`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Usuário restaurado.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  restaurar(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoUsers.restaurar(id);
  }

  // Irreversível: apaga a linha de verdade do banco (hard delete).
  @Delete(':id/permanent')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um usuário permanentemente (hard delete)',
    description:
      'Apaga a linha de verdade do banco — irreversível, diferente do `DELETE /users/:id` ' +
      '(soft delete). Acesso: ADMIN.\n\n' +
      '`x-database-tables`: lê `users`; escreve (apaga) em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Usuário apagado definitivamente (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ErroPadraoDto) } })
  async removerPermanentemente(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.servicoUsers.removerPermanentemente(id);
  }
}
