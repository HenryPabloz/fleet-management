import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { buscarCodigosEfetivos, buscarDriverIdAtivo } from '../common/utils/perfil-logado.util';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginWithApiKeyDto } from './dto/login-with-api-key.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { UsuarioLogado } from './interfaces/usuario-logado.interface';

// Hash fixo usado para gastar o mesmo tempo quando o e-mail não existe.
const HASH_FALSO =
  '$2b$10$Gkbv/VFucUEMp3JrsU2xAuZ6idnNtTW0WqM8ZT3oNy4LZ0r8AxdSm';

@Injectable()
export class AuthService {
  constructor(
    private servicoPrisma: PrismaService,
    private servicoJwt: JwtService,
  ) {}

  async loginWithApiKey(dadosLogin: LoginWithApiKeyDto): Promise<LoginResponseDto> {
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

    if (!usuario || !senhaCorreta) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Só checa depois de confirmar a senha, senão vazaria se o e-mail existe.
    if (!usuario.isActive) {
      throw new ForbiddenException('User account is inactive');
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
        permissions: await buscarCodigosEfetivos(this.servicoPrisma, usuario.id, usuario.roleId),
        driverId: await buscarDriverIdAtivo(this.servicoPrisma, usuario.id),
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
        permissions: await buscarCodigosEfetivos(this.servicoPrisma, usuario.id, usuario.roleId),
        driverId: await buscarDriverIdAtivo(this.servicoPrisma, usuario.id),
      },
    };
  }
}
