import {
  Body,
  Controller,
  Header,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ProblemDetailsDto } from '../common/swagger/problem-details.schema';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginWithApiKeyDto } from './dto/login-with-api-key.dto';
import { RegenerateApiKeyDto } from './dto/regenerate-api-key.dto';
import { RegenerateApiKeyResponseDto } from './dto/regenerate-api-key-response.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import { JwtAuthGuard } from './guards/jwt.guard';
import type { UsuarioLogado } from './interfaces/usuario-logado.interface';

@ApiTags('auth')
@ApiExtraModels(ProblemDetailsDto)
@Controller('auth')
export class AuthController {
  constructor(private servicoAuth: AuthService) {}

  @Post('login')
  @UseGuards(ApiKeyGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Login com e-mail, senha e API key',
    description:
      'Confirma e-mail + senha (no corpo) e a API key (header `x-api-key`) do mesmo ' +
      'usuário, e devolve um token JWT para as rotas protegidas por Bearer. ' +
      'Qualquer usuário autenticado por API key pode chamar.\n\n' +
      '`x-database-tables`: lê `users` (valida a chave e as credenciais); escreve em `users` (registra o último uso da chave).',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: LoginWithApiKeyDto })
  @ApiResponse({ status: 200, description: 'Login efetuado.', type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Corpo da requisição inválido (e-mail ou senha fora do formato esperado).',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({
    status: 401,
    description:
      'API key ausente/inválida, ou e-mail/senha/chave não conferem entre si.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({
    status: 403,
    description: 'A conta dona da API key está inativa.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  async loginWithApiKey(
    @Body() dadosLogin: LoginWithApiKeyDto,
    @CurrentUser() usuario: UsuarioLogado,
  ): Promise<LoginResponseDto> {
    return this.servicoAuth.loginWithApiKey(dadosLogin, usuario.userId);
  }

  @Patch('regenerate-key')
  @UseGuards(ApiKeyGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Gera uma nova API key para o usuário autenticado',
    description:
      'Troca a API key do usuário dono da chave enviada em `x-api-key`. Exige também a ' +
      '`password` do usuário no corpo (a chave sozinha não basta). A chave antiga é ' +
      'invalidada na hora; a nova só aparece nesta resposta. O JWT em uso continua válido. ' +
      'Perdeu a chave? Peça a um ADMIN: `POST /users/{id}/regenerate-api-key`.\n\n' +
      '`x-database-tables`: lê `users` (valida a chave atual); escreve em `users` (grava o hash da nova chave).',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: RegenerateApiKeyDto })
  @ApiResponse({
    status: 400,
    description: 'Corpo inválido (ex: `password` ausente).',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({
    status: 200,
    description: 'Nova API key gerada.',
    type: RegenerateApiKeyResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'API key ausente/inválida ou senha incorreta (mensagem genérica).',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({
    status: 403,
    description: 'A conta dona da API key está inativa.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  async regenerateApiKey(
    @CurrentUser() usuario: UsuarioLogado,
    @Body() dados: RegenerateApiKeyDto,
  ): Promise<RegenerateApiKeyResponseDto> {
    return this.servicoAuth.regenerateApiKeyComSenha(
      usuario.userId,
      dados.password,
    );
  }

  @Post('refresh-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Renova o JWT do usuário autenticado',
    description:
      'Troca um JWT ainda válido (header `Authorization: Bearer <token>`) por um ' +
      'novo, com a mesma carga (usuário) e prazo renovado. Não gera um refresh ' +
      'token separado, e não confunda com `PATCH /auth/regenerate-key`: aquela ' +
      'rota troca a API key (`x-api-key`), esta troca o JWT (`Authorization: Bearer`).\n\n' +
      '`x-database-tables`: lê `users` (confirma que a conta ainda existe e está ativa).',
    ...({
      'x-database-tables': { read: ['users'], write: [] },
    } as Record<string, unknown>),
  })
  @ApiResponse({ status: 200, description: 'Token renovado.', type: LoginResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido, expirado, ou dono do token inativo/inexistente.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  async refreshToken(
    @CurrentUser() usuario: UsuarioLogado,
  ): Promise<LoginResponseDto> {
    return this.servicoAuth.refreshToken(usuario);
  }
}
