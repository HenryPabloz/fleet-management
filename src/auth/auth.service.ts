import {
  ConflictException,
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
import { SignupResponseDto } from './dto/signup-response.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { calcularHashApiKey, gerarApiKey } from './utils/api-key.util';

// Hash fixo usado para gastar o mesmo tempo quando o e-mail não existe.
const HASH_FALSO =
  '$2b$10$Gkbv/VFucUEMp3JrsU2xAuZ6idnNtTW0WqM8ZT3oNy4LZ0r8AxdSm';

// Quantas vezes tenta gerar outra chave se o banco disser que ela já existe.
const MAXIMO_TENTATIVAS_CHAVE = 3;

// Todo cadastro público entra com este papel.
const PAPEL_PADRAO = 'DRIVER';

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

  async signup(dadosCadastro: SignupDto): Promise<SignupResponseDto> {
    // O papel vem sempre do servidor, nunca de quem se cadastra.
    const papel = await this.servicoPrisma.role.findUnique({
      where: { name: PAPEL_PADRAO },
    });
    if (!papel) {
      this.registro.error(
        `Papel ${PAPEL_PADRAO} não encontrado. O seed foi executado?`,
      );
      throw new InternalServerErrorException();
    }

    const hashDaSenha = await bcrypt.hash(dadosCadastro.password, 10);

    for (let tentativa = 1; tentativa <= MAXIMO_TENTATIVAS_CHAVE; tentativa++) {
      const chave = this.generateApiKey();
      try {
        const usuario = await this.servicoPrisma.user.create({
          data: {
            email: dadosCadastro.email,
            password: hashDaSenha,
            fullName: dadosCadastro.fullName,
            roleId: papel.id,
            apiKey: calcularHashApiKey(chave),
            apiKeyCreatedAt: new Date(),
          },
        });
        return {
          userId: usuario.id,
          apiKey: chave,
          email: usuario.email,
          message: 'Save your API key securely',
        };
      } catch (erro) {
        if (!this.ehErroDeUnicidade(erro)) {
          throw erro;
        }
        // Se o e-mail já existe é conflito; senão a chave repetiu e tenta outra.
        const emailJaExiste = await this.servicoPrisma.user.findUnique({
          where: { email: dadosCadastro.email },
        });
        if (emailJaExiste) {
          throw new ConflictException('Email already registered');
        }
      }
    }

    this.registro.error(
      'Não foi possível gerar uma API key única no cadastro.',
    );
    throw new InternalServerErrorException();
  }

  async loginWithApiKey(
    dadosLogin: LoginWithApiKeyDto,
    idDonoDaChave: string,
  ): Promise<LoginResponseDto> {
    // O banco só guarda e-mail em minúsculas e sem espaços.
    const emailNormalizado = dadosLogin.email.trim().toLowerCase();

    const usuario = await this.servicoPrisma.user.findUnique({
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
  async validateApiKey(hashDaChave: string) {
    return this.servicoPrisma.user.findUnique({
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
