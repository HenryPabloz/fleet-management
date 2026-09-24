import { randomBytes } from 'crypto';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/database/prisma.service';

export const SENHA_PADRAO = 'SenhaForte123';

// CNH de teste: 11 dígitos, sempre começando com 9 para não colidir com dados reais.
export function novaCnh(): string {
  const sufixo = Math.floor(Math.random() * 10000000000);
  return `9${sufixo.toString().padStart(10, '0')}`;
}

export function dataFutura(): string {
  const data = new Date();
  data.setFullYear(data.getFullYear() + 3);
  return data.toISOString().slice(0, 10);
}

export interface UsuarioCriado {
  id: string;
  email: string;
  apiKey: string;
  token: string;
  roleId: string;
  driverId?: string;
}

// O ADMIN cria o usuário por POST /users (com bloco driver se for DRIVER),
// recebe a apiKey na resposta e faz login com ela.
export async function criarUsuarioELogar(
  app: INestApplication,
  prisma: PrismaService,
  tokenAdmin: string,
  nomeDoPapel: string,
  prefixoEmail: string,
  nomeCompleto = 'Usuario Teste',
): Promise<UsuarioCriado> {
  const papel = await prisma.role.findUnique({ where: { name: nomeDoPapel } });
  if (!papel) {
    throw new Error(`Papel ${nomeDoPapel} não encontrado. O seed foi executado?`);
  }

  const email = `${prefixoEmail}-${randomBytes(6).toString('hex')}@test.local`;
  const corpo: Record<string, unknown> = {
    email,
    password: SENHA_PADRAO,
    fullName: nomeCompleto,
    roleId: papel.id,
  };
  if (nomeDoPapel === 'DRIVER') {
    corpo.driver = { licenseNumber: novaCnh(), licenseExpiry: dataFutura() };
  }

  const criacao = await request(app.getHttpServer())
    .post('/users')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(corpo)
    .expect(201);

  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .set('x-api-key', criacao.body.apiKey)
    .send({ email, password: SENHA_PADRAO })
    .expect(200);

  return {
    id: criacao.body.id as string,
    email,
    apiKey: criacao.body.apiKey as string,
    token: login.body.accessToken as string,
    roleId: papel.id,
    driverId: criacao.body.driver?.id as string | undefined,
  };
}
