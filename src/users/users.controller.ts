import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UsuarioLogado } from '../auth/interfaces/usuario-logado.interface';
import { NomePipe } from '../common/pipes/name-pipe';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginacaoMetadataDto } from '../common/swagger/pagination-response.schema';
import { ProblemDetailsDto } from '../common/swagger/problem-details.schema';
import { RegenerateApiKeyResponseDto } from '../auth/dto/regenerate-api-key-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateMeuPerfilDto } from './dto/update-meu-perfil.dto';
import { TrocarSenhaDto } from './dto/trocar-senha.dto';
import { TrocarRoleDto } from './dto/trocar-role.dto';
import {
  UserComMotoristaRespostaDto,
  UserCriadoRespostaDto,
  UserRemovidoRespostaDto,
  UserRespostaDto,
  MeuPerfilRespostaDto,
} from './dto/user-response.dto';
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
@ApiExtraModels(ProblemDetailsDto, PaginacaoMetadataDto, UserRespostaDto, UserRemovidoRespostaDto, UserCriadoRespostaDto, UserComMotoristaRespostaDto)
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private servicoUsers: UsersService) {}

  @Get()
  @Permissions('USER_VIEW')
  @ApiOperation({
    summary: 'Lista usuários (paginado)',
    description:
      'Lista usuários ativos (não removidos), paginado. Acesso: permission `USER_VIEW` (ADMIN por papel; FLEET_MANAGER só se receber por delegação).\n\n' +
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
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listar(@Query() paginacao: PaginationQueryDto) {
    return this.servicoUsers.listar(paginacao.page, paginacao.pageSize);
  }

  // Precisa vir antes de "GET /:id", senão "deleted" seria lido como um id.
  @Get('deleted/all')
  @Permissions('USER_RESTORE')
  @ApiOperation({
    summary: 'Lista usuários removidos (soft delete), paginado',
    description:
      'Lista usuários já removidos logicamente (deletedAt preenchido), paginado. Acesso: permission `USER_RESTORE` (ADMIN por papel; delegável a outros usuários).\n\n' +
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
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  listarRemovidos(@Query() paginacao: PaginationQueryDto) {
    return this.servicoUsers.listarRemovidos(
      paginacao.page,
      paginacao.pageSize,
    );
  }

  // Precisa vir antes de "GET /:id", senão "me" seria lido como um id.
  @Get('me')
  @Permissions('PROFILE_VIEW')
  @ApiOperation({
    summary: 'Busca o perfil do usuário logado',
    description:
      'Devolve os dados do próprio usuário autenticado (nunca senha/hash). Acesso: qualquer ' +
      'papel com a permissão `PROFILE_VIEW` (todos por padrão: ADMIN, FLEET_MANAGER, DRIVER).\n\n' +
      'Inclui `permissions` (códigos efetivos: papel + concedidas individualmente) e `driverId` (id do perfil de motorista ativo, ou null).\n\n' +
      '`x-database-tables`: lê `users`, `role_permissions`, `user_permissions`, `drivers`.',
    ...({ 'x-database-tables': { read: ['users', 'role_permissions', 'user_permissions', 'drivers'] } } as Record<string, unknown>),
  })
  @ApiResponse({ status: 200, description: 'Perfil do usuário logado.', type: MeuPerfilRespostaDto })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Usuário autenticado não tem a permissão PROFILE_VIEW.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  buscarMeuPerfil(@CurrentUser() usuario: UsuarioLogado) {
    return this.servicoUsers.buscarMeuPerfil(usuario.userId);
  }

  @Patch('me')
  @Permissions('PROFILE_UPDATE_OWN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atualiza o próprio perfil (fullName)',
    description:
      'Atualiza o nome do próprio usuário autenticado. E-mail, senha, papel (`roleId`) e ' +
      '`isActive` não entram aqui — isso é `PATCH /users/:id`, rota administrativa. Acesso: ' +
      'qualquer papel com a permissão `PROFILE_UPDATE_OWN` (todos por padrão: ADMIN, ' +
      'FLEET_MANAGER, DRIVER).\n\n' +
      '`x-database-tables`: lê `users`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: UpdateMeuPerfilDto })
  @ApiResponse({ status: 200, description: 'Perfil atualizado.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Usuário autenticado não tem a permissão PROFILE_UPDATE_OWN.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  atualizarMeuPerfil(
    @CurrentUser() usuario: UsuarioLogado,
    @Body() dados: UpdateMeuPerfilDto,
    // fullName é opcional aqui; o NomePipe deixa passar quando não vem.
    @Body('fullName', NomePipe) _fullName: string | undefined,
  ) {
    return this.servicoUsers.atualizarMeuPerfil(usuario.userId, dados);
  }

  @Patch('me/password')
  @Permissions('PASSWORD_CHANGE_OWN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Troca a própria senha',
    description:
      'Exige a senha atual correta antes de gravar a nova (mesmo hash bcrypt usado no resto do ' +
      'projeto). Acesso: qualquer papel com a permissão `PASSWORD_CHANGE_OWN` (todos por padrão: ' +
      'ADMIN, FLEET_MANAGER, DRIVER).\n\n' +
      '`x-database-tables`: lê `users`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: TrocarSenhaDto })
  @ApiResponse({ status: 200, description: 'Senha trocada (sem corpo de dados sensíveis na resposta).' })
  @ApiResponse({ status: 400, description: 'Corpo inválido (ex: senha nova fora do tamanho permitido).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente/inválido/expirado, ou `currentPassword` incorreta.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Usuário autenticado não tem a permissão PASSWORD_CHANGE_OWN.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async trocarSenha(
    @CurrentUser() usuario: UsuarioLogado,
    @Body() dados: TrocarSenhaDto,
  ): Promise<{ message: string }> {
    await this.servicoUsers.trocarSenha(usuario.userId, dados);
    return { message: 'Password changed' };
  }

  @Get(':id')
  @Permissions('USER_VIEW')
  @ApiOperation({
    summary: 'Busca um usuário por id',
    description:
      'Busca um usuário ativo pelo id. Acesso: permission `USER_VIEW` (ADMIN por papel; FLEET_MANAGER só se receber por delegação).\n\n' +
      '`x-database-tables`: lê `users`.',
    ...({ 'x-database-tables': { read: ['users'] } } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Usuário encontrado.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Papel do usuário autenticado não tem acesso.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoUsers.buscarPorId(id);
  }

  @Post()
  @Permissions('USER_CREATE')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Cria um usuário (e gera a API key dele)',
    description:
      'Único caminho de cadastro do sistema (não existe cadastro público). Cria o usuário com o papel (`roleId`) ' +
      'informado, gera a API key, grava só o hash e devolve a chave em texto (`apiKey`) UMA única vez: ' +
      'guarde e entregue ao usuário; ela não é mostrada de novo (perdeu? `POST /users/{id}/regenerate-api-key`, só ADMIN). ' +
      'Com papel DRIVER o bloco `driver` (`licenseNumber` com 11 dígitos, `licenseExpiry`) é OBRIGATÓRIO e cria conta + perfil ' +
      'de motorista na mesma transação; com outro papel, `driver` retorna 400. ' +
      'Quem pode atribuir o quê: ADMIN atribui qualquer papel; quem não é ADMIN (ex: FLEET_MANAGER, que tem `USER_CREATE` por padrão) ' +
      'só cria usuários DRIVER, senão 403. Acesso: permission `USER_CREATE`.\n\n' +
      '`x-database-tables`: lê `users` (checa e-mail duplicado), `roles` (valida roleId), `drivers` (CNH duplicada); escreve em `users` e, com `driver`, em `drivers`.',
    ...({
      'x-database-tables': { read: ['users', 'roles', 'drivers'], write: ['users', 'drivers'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'Usuário criado; traz `apiKey` (só desta vez) e `driver` quando houver.', type: UserCriadoRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido, `roleId` inexistente, DRIVER sem bloco `driver`, `driver` com papel diferente de DRIVER ou CNH vencida.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Sem a permission `USER_CREATE`, ou quem não é ADMIN tentou criar papel diferente de DRIVER.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado ou CNH (bloco `driver`) já cadastrada.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  criar(
    @Body() dados: CreateUserDto,
    // Roda separado só pela validação; os dados de verdade vêm de dados.
    @Body('fullName', NomePipe) _fullName: string,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    return this.servicoUsers.criar(dados, usuario);
  }

  // Só ADMIN com USER_ROLE_PROMOTE; só sobe de cargo.
  @Patch(':id/role')
  @Roles('ADMIN')
  @Permissions('USER_ROLE_PROMOTE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Promove o papel de um usuário',
    description:
      'Só PROMOVE o papel (`roleId`). Ranking: DRIVER < FLEET_MANAGER < ADMIN; permitido: DRIVER→FLEET_MANAGER, DRIVER→ADMIN, FLEET_MANAGER→ADMIN. ' +
      'Exige a permission `USER_ROLE_PROMOTE` (ADMIN tem por padrão). Acesso: somente ADMIN. ' +
      'Regras: o mesmo papel ou um papel menor retorna 409 (rebaixar não é suportado); um ADMIN alvo retorna 403; ninguém altera o próprio papel (409). ' +
      'ATENÇÃO: uma promoção feita por engano não pode ser desfeita pela API. ' +
      'A mudança vale na hora, inclusive para o JWT já emitido (o papel é lido do banco a cada requisição).\n\n' +
      '`x-database-tables`: lê `users`, `roles`, `role_permissions`, `user_permissions`; escreve em `users`.',
    ...({
      'x-database-tables': {
        read: ['users', 'roles', 'role_permissions', 'user_permissions'],
        write: ['users'],
      },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiBody({ type: TrocarRoleDto })
  @ApiResponse({ status: 200, description: 'Papel promovido.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: '`roleId` inexistente ou corpo inválido (inclui enviar `driver`, que não é mais aceito).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Não é ADMIN, falta a permission `USER_ROLE_PROMOTE`, ou o alvo é um ADMIN.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado (ou removido).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Mudança da própria role, ou papel igual/menor ao atual (só é permitido subir).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  trocarRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: TrocarRoleDto,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    return this.servicoUsers.trocarRole(id, dados, usuario);
  }

  // Poder sensível: só ADMIN, sem delegação por permissão.
  @Post(':id/regenerate-api-key')
  @Roles('ADMIN')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Reemite a API key de outro usuário',
    description:
      'Use quando um usuário perdeu a API key: gera uma nova, grava só o hash e devolve a chave em texto ' +
      'UMA única vez. A chave antiga deixa de valer na hora (o JWT já emitido continua válido até expirar). ' +
      'Acesso: somente ADMIN (não delegável). Para trocar a própria chave use `PATCH /auth/regenerate-key`.\n\n' +
      '`x-database-tables`: lê `users` (confirma que existe e não foi removido); escreve em `users` (hash da nova chave).',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário que perdeu a chave (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Nova API key emitida.', type: RegenerateApiKeyResponseDto })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Somente ADMIN.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado (ou removido).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  regenerarApiKey(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicoUsers.regenerarApiKey(id);
  }

  @Patch(':id')
  @Permissions('USER_UPDATE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atualiza parcialmente um usuário',
    description:
      'Atualiza só os campos enviados (fullName, isActive). E-mail, senha e papel não entram aqui: o papel (`roleId`) só muda por `PATCH /users/:id/role` (enviar `roleId` aqui devolve 400). ' +
      'Acesso: quem tiver a permissão `USER_UPDATE` (ADMIN tem por papel; outros papéis podem receber via delegação granular). ' +
      'Proteção de contas ADMIN: quem não é ADMIN nunca mexe em conta ADMIN (403, mesmo com a permission delegada); ' +
      'ADMIN não desativa (`isActive=false`) outro ADMIN (403) nem a si mesmo (409), mas pode editar `fullName` e reativar.\n\n' +
      '`x-database-tables`: lê `users`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'Usuário atualizado.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Corpo inválido (inclui `roleId`, que não é aceito aqui).', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Sem permission, não-ADMIN mexendo em conta ADMIN, ou ADMIN desativando outro ADMIN.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'ADMIN tentou desativar a própria conta.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  atualizarParcial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dados: UpdateUserDto,
    // fullName é opcional no PATCH; o NomePipe deixa passar quando não vem.
    @Body('fullName', NomePipe) _fullName: string | undefined,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    return this.servicoUsers.atualizarParcial(id, dados, usuario);
  }

  @Delete(':id')
  @Permissions('USER_DELETE')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um usuário (soft delete)',
    description:
      'Marca `deletedAt` no usuário; a linha continua no banco e pode ser restaurada ' +
      'em `PATCH /users/:id/restore`. Acesso: quem tiver a permissão `USER_DELETE` (ADMIN tem por papel; ' +
      'outros papéis podem receber via delegação granular). ' +
      'Proteção de contas ADMIN: não-ADMIN nunca remove conta ADMIN (403); ADMIN não remove outro ADMIN (403) nem a si mesmo (409).\n\n' +
      '`x-database-tables`: lê `users`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Usuário removido (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Sem permission, alvo ADMIN e chamador não-ADMIN, ou ADMIN removendo outro ADMIN.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'ADMIN tentou remover a própria conta.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async remover(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() usuario: UsuarioLogado,
  ): Promise<void> {
    await this.servicoUsers.remover(id, usuario);
  }

  @Patch(':id/restore')
  @Permissions('USER_RESTORE')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaura um usuário removido',
    description:
      'Limpa `deletedAt`, revertendo o soft delete. Acesso: quem tiver a permissão `USER_RESTORE` ' +
      '(ADMIN tem por papel; outros papéis podem receber via delegação granular). ' +
      'Proteção de contas ADMIN: só um ADMIN restaura conta ADMIN (403 para os demais).\n\n' +
      '`x-database-tables`: lê `users`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Usuário restaurado.', type: UserRespostaDto })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Sem permission, ou alvo ADMIN e chamador não-ADMIN.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  restaurar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() usuario: UsuarioLogado,
  ) {
    return this.servicoUsers.restaurar(id, usuario);
  }

  // Irreversível: apaga a linha de verdade do banco (hard delete).
  @Delete(':id/permanent')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove um usuário permanentemente (hard delete)',
    description:
      'Apaga a linha de verdade do banco — irreversível, diferente do `DELETE /users/:id` ' +
      '(soft delete). Acesso: ADMIN. Proteção de contas ADMIN: não apaga outro ADMIN (403) nem a si mesmo (409).\n\n' +
      '`x-database-tables`: lê `users`; escreve (apaga) em `users`.',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiParam({ name: 'id', description: 'Id do usuário (UUID).', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Usuário apagado definitivamente (sem corpo de resposta).' })
  @ApiResponse({ status: 400, description: 'Id fora do formato UUID.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 403, description: 'Não é ADMIN, ou tentou apagar outro ADMIN.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  @ApiResponse({ status: 409, description: 'Tentou apagar a própria conta; ou usuário tem motorista vinculado, ou registrou viagens, abastecimentos, manutenções ou incidentes. O histórico de auditoria NÃO bloqueia: as linhas de audit_logs permanecem com autor nulo.', schema: { $ref: getSchemaPath(ProblemDetailsDto) } })
  async removerPermanentemente(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() usuario: UsuarioLogado,
  ): Promise<void> {
    await this.servicoUsers.removerPermanentemente(id, usuario);
  }
}
