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
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ErroPadraoDto } from '../common/swagger/erro-padrao.schema';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginWithApiKeyDto } from './dto/login-with-api-key.dto';
import { RegenerateApiKeyResponseDto } from './dto/regenerate-api-key-response.dto';
import { SignupResponseDto } from './dto/signup-response.dto';
import { SignupDto } from './dto/signup.dto';
import { ApiKeyGuard } from './guards/api-key.guard';
import type { UsuarioLogado } from './interfaces/usuario-logado.interface';

@ApiTags('auth')
@ApiExtraModels(ErroPadraoDto)
@Controller('auth')
export class AuthController {
  constructor(private servicoAuth: AuthService) {}

  // A resposta traz a chave em texto: não pode ficar guardada em cache.
  // Limite restrito: protege contra força bruta de senha/chave.
  @Post('signup')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Cadastro público de usuário',
    description:
      'Cria um usuário com papel DRIVER (fixo, definido pelo servidor) e devolve ' +
      'uma API key em texto puro — só aparece aqui, o banco guarda só o hash dela. ' +
      'Rota pública, sem autenticação.\n\n' +
      '`x-database-tables`: lê `roles`; escreve em `users`.',
    ...({
      'x-database-tables': { read: ['roles'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiBody({ type: SignupDto })
  @ApiResponse({ status: 201, description: 'Usuário criado.', type: SignupResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Corpo da requisição inválido (ex: e-mail mal formatado, senha curta).',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  @ApiResponse({
    status: 409,
    description: 'E-mail já cadastrado.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  async signup(@Body() dadosCadastro: SignupDto): Promise<SignupResponseDto> {
    return this.servicoAuth.signup(dadosCadastro);
  }

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
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  @ApiResponse({
    status: 401,
    description:
      'API key ausente/inválida, ou e-mail/senha/chave não conferem entre si.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  @ApiResponse({
    status: 403,
    description: 'A conta dona da API key está inativa.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
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
      'Troca a API key do usuário dono da chave enviada em `x-api-key`. A chave ' +
      'antiga é invalidada na hora; a nova só aparece nesta resposta.\n\n' +
      '`x-database-tables`: lê `users` (valida a chave atual); escreve em `users` (grava o hash da nova chave).',
    ...({
      'x-database-tables': { read: ['users'], write: ['users'] },
    } as Record<string, unknown>),
  })
  @ApiResponse({
    status: 200,
    description: 'Nova API key gerada.',
    type: RegenerateApiKeyResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'API key ausente ou inválida.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  @ApiResponse({
    status: 403,
    description: 'A conta dona da API key está inativa.',
    schema: { $ref: getSchemaPath(ErroPadraoDto) },
  })
  async regenerateApiKey(
    @CurrentUser() usuario: UsuarioLogado,
  ): Promise<RegenerateApiKeyResponseDto> {
    return this.servicoAuth.regenerateApiKey(usuario.userId);
  }
}
