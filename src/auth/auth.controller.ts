import {
  Body,
  Controller,
  Header,
  HttpCode,
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
      'Confirma e-mail + senha (no corpo) e a API key (header `x-api-key`), e devolve um ' +
      'token JWT para as rotas protegidas por Bearer. A API key é uma chave FIXA da ' +
      'aplicação (variável de ambiente `API_KEY`), a mesma para todos os usuários — ' +
      'ela não identifica ninguém, só libera o acesso a esta rota; quem identifica o ' +
      'usuário são o e-mail e a senha do corpo.\n\n' +
      '`x-database-tables`: lê `users` (valida as credenciais).',
    ...({
      'x-database-tables': { read: ['users'], write: [] },
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
    description: 'API key ausente/inválida, ou e-mail/senha não conferem.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  @ApiResponse({
    status: 403,
    description: 'A conta do usuário está inativa.',
    schema: { $ref: getSchemaPath(ProblemDetailsDto) },
  })
  async loginWithApiKey(
    @Body() dadosLogin: LoginWithApiKeyDto,
  ): Promise<LoginResponseDto> {
    return this.servicoAuth.loginWithApiKey(dadosLogin);
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
      'token separado; não confunda com `POST /auth/login`, que usa `x-api-key` ' +
      '(chave fixa da aplicação) mais e-mail/senha.\n\n' +
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
