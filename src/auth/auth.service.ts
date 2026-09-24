import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginWithApiKeyDto } from './dto/login-with-api-key.dto';
import { RegenerateApiKeyResponseDto } from './dto/regenerate-api-key-response.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { UsuarioLogado } from './interfaces/usuario-logado.interface';
import { calcularHashApiKey, gerarApiKey } from './utils/api-key.util';

// Hash fixo usado para gastar o mesmo tempo quando o e-mail não existe.
const HASH_FALSO =
  '$2b$10$Gkbv/VFucUEMp3JrsU2xAuZ6idnNtTW0WqM8ZT3oNy4LZ0r8AxdSm';

// Quantas vezes tenta gerar outra chave se o banco disser que ela já existe.
const MAXIMO_TENTATIVAS_CHAVE = 3;

@Injectable()
export class AuthService {
  private registro = new Logger(AuthService.name);

  constructor(
    private servicoPrisma: PrismaService,
    private servicoJwt: JwtService,
  ) {}

  generateApiKey(): string {
    return gerarApiKey();
  }

  async loginWithApiKey(
    dadosLogin: LoginWithApiKeyDto,
    idDonoDaChave: string,
  ): Promise<LoginResponseDto> {
    // O banco só guarda e-mail em minúsculas e sem espaços.
    const emailNormalizado = dadosLogin.email.trim().toLowerCase();

    // comSoftDelete: usuário soft-deletado não consegue logar de novo.
    const usuario = await this.servicoPrisma.comSoftDelete.user.findUnique({
      where: { email: emailNormalizado },
      include: { role: true },
    });

    // Mesmo sem usuário, compara com um hash falso para não revelar o e-mail pelo tempo.
    let hashParaComparar = HASH_FALSO;
    if (usuario) {
      hashParaComparar = usuario.password;
    }
    const senhaCorreta = await bcrypt.compare(
      dadosLogin.password,
      hashParaComparar,
    );

    // A chave precisa ser do mesmo usuário do e-mail e senha.
    if (!usuario || !senhaCorreta || usuario.id !== idDonoDaChave) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const carga: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: usuario.id,
      email: usuario.email,
      roleId: usuario.roleId,
    };

    return {
      accessToken: this.servicoJwt.sign(carga),
      user: {
        id: usuario.id,
        email: usuario.email,
        fullName: usuario.fullName,
        role: usuario.role.name,
      },
    };
  }

  // Troca um JWT ainda válido por um novo, com prazo renovado e a mesma carga.
  async refreshToken(usuarioLogado: UsuarioLogado): Promise<LoginResponseDto> {
    // comSoftDelete: reforça que um usuário removido não renova token.
    const usuario = await this.servicoPrisma.comSoftDelete.user.findUnique({
      where: { id: usuarioLogado.userId },
      include: { role: true },
    });

    // Reforça aqui a mesma checagem da JwtStrategy: ação sensível, confirma de novo.
    if (!usuario || !usuario.isActive) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const carga: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: usuario.id,
      email: usuario.email,
      roleId: usuario.roleId,
    };

    return {
      accessToken: this.servicoJwt.sign(carga),
      user: {
        id: usuario.id,
        email: usuario.email,
        fullName: usuario.fullName,
        role: usuario.role.name,
      },
    };
  }

  // Confere a senha do dono da chave e só então troca a chave.
  async regenerateApiKeyComSenha(
    userId: string,
    senha: string,
  ): Promise<RegenerateApiKeyResponseDto> {
    const usuario = await this.servicoPrisma.comSoftDelete.user.findUnique({
      where: { id: userId },
    });
    let hashParaComparar = HASH_FALSO;
    if (usuario) {
      hashParaComparar = usuario.password;
    }
    const senhaCorreta = await bcrypt.compare(senha, hashParaComparar);
    if (!usuario || !senhaCorreta) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.regenerateApiKey(userId);
  }

  async regenerateApiKey(userId: string): Promise<RegenerateApiKeyResponseDto> {
    for (let tentativa = 1; tentativa <= MAXIMO_TENTATIVAS_CHAVE; tentativa++) {
      const chave = this.generateApiKey();
      try {
        // Gravar o novo hash já invalida a chave antiga.
        await this.servicoPrisma.user.update({
          where: { id: userId },
          data: {
            apiKey: calcularHashApiKey(chave),
            apiKeyCreatedAt: new Date(),
            apiKeyLastUsedAt: null,
          },
        });
        return { newApiKey: chave, message: 'Old key is now invalid' };
      } catch (erro) {
        if (!this.ehErroDeUnicidade(erro)) {
          throw erro;
        }
      }
    }

    this.registro.error('Não foi possível gerar uma API key única.');
    throw new InternalServerErrorException();
  }

  // Recebe o hash da chave; devolve o usuário (com papel) ou null.
  // comSoftDelete: usuário soft-deletado nunca é encontrado, então a API key dele para de funcionar.
  async validateApiKey(hashDaChave: string) {
    return this.servicoPrisma.comSoftDelete.user.findUnique({
      where: { apiKey: hashDaChave },
      include: { role: true },
    });
  }

  async registrarUsoDaApiKey(userId: string): Promise<void> {
    await this.servicoPrisma.user.update({
      where: { id: userId },
      data: { apiKeyLastUsedAt: new Date() },
    });
  }

  // P2002 é o código do Prisma para "valor repetido em campo único".
  private ehErroDeUnicidade(erro: unknown): boolean {
    return (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    );
  }
}
