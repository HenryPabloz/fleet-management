import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';

const SENHA = 'SenhaForte123';

jest.setTimeout(60000);

// Cobre: reemissão de API key (ADMIN), POST /users com bloco driver (obrigatório para DRIVER) e a remoção de POST /drivers.
describe('Users: reemissão de chave e cadastro de motorista (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicoJwt: JwtService;
  let tokenAdmin: string;
  let roleIdDriver: string;
  let roleIdFleetManager: string;
  let roleIdAdmin: string;

  const idsDeUsuarioParaLimpar: string[] = [];
  const emailsCriados: string[] = [];

  function novoEmail(): string {
    const email = `e2e-mot-${randomBytes(6).toString('hex')}@test.local`;
    emailsCriados.push(email);
    return email;
  }

  function novaCnh(): string {
    return randomBytes(6).readUIntBE(0, 6).toString().padStart(11, '0').slice(-11);
  }

  function dataFutura(): string {
    const data = new Date();
    data.setFullYear(data.getFullYear() + 2);
    return data.toISOString();
  }

  function autenticado(
    token: string,
    metodo: 'get' | 'post' | 'patch' | 'put' | 'delete',
    caminho: string,
  ) {
    return request(app.getHttpServer())
      [metodo](caminho)
      .set('Authorization', `Bearer ${token}`);
  }

  async function criarUsuario(roleId: string) {
    const corpo: Record<string, unknown> = {
      email: novoEmail(),
      password: SENHA,
      fullName: 'Usuario Teste',
      roleId,
    };
    if (roleId === roleIdDriver) {
      corpo.driver = { licenseNumber: novaCnh(), licenseExpiry: dataFutura() };
    }
    const resposta = await autenticado(tokenAdmin, 'post', '/users').send(corpo).expect(201);
    idsDeUsuarioParaLimpar.push(resposta.body.id);
    return resposta.body as { id: string; email: string };
  }

  // Dá uma chave conhecida ao usuário (via rota ADMIN) e devolve a chave em texto.
  async function reemitirChave(idUsuario: string): Promise<string> {
    const resposta = await autenticado(
      tokenAdmin,
      'post',
      `/users/${idUsuario}/regenerate-api-key`,
    ).expect(200);
    return resposta.body.newApiKey;
  }

  function entrar(chave: string, email: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', chave)
      .send({ email, password: SENHA });
  }

  beforeAll(async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    await app.init();

    prisma = app.get(PrismaService);
    servicoJwt = app.get(JwtService);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', process.env.ADMIN_API_KEY as string)
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      })
      .expect(200);
    tokenAdmin = login.body.accessToken;

    const papeis = await prisma.role.findMany();
    const achar = (nome: string) => papeis.find((papel) => papel.name === nome)?.id as string;
    roleIdDriver = achar('DRIVER');
    roleIdFleetManager = achar('FLEET_MANAGER');
    roleIdAdmin = achar('ADMIN');
  });

  afterAll(async () => {
    if (prisma) {
      const usuarios = await prisma.user.findMany({
        where: { OR: [{ id: { in: idsDeUsuarioParaLimpar } }, { email: { in: emailsCriados } }] },
        select: { id: true },
      });
      const ids = usuarios.map((usuario) => usuario.id);
      await prisma.driver.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /users/:id/regenerate-api-key', () => {
    it('ADMIN reemite: a chave nova loga o alvo e a antiga deixa de valer', async () => {
      const alvo = await criarUsuario(roleIdDriver);
      const chaveAntiga = await reemitirChave(alvo.id);
      await entrar(chaveAntiga, alvo.email).expect(200);

      const resposta = await autenticado(
        tokenAdmin,
        'post',
        `/users/${alvo.id}/regenerate-api-key`,
      ).expect(200);
      expect(resposta.body.newApiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(resposta.headers['cache-control']).toEqual('no-store');

      await entrar(resposta.body.newApiKey, alvo.email).expect(200);
      await entrar(chaveAntiga, alvo.email).expect(401);
    });

    it('FLEET_MANAGER e DRIVER recebem 403', async () => {
      const alvo = await criarUsuario(roleIdDriver);
      const gerente = await criarUsuario(roleIdFleetManager);
      const motorista = await criarUsuario(roleIdDriver);

      for (const quem of [
        { usuario: gerente, roleId: roleIdFleetManager },
        { usuario: motorista, roleId: roleIdDriver },
      ]) {
        const token = servicoJwt.sign({
          sub: quem.usuario.id,
          email: quem.usuario.email,
          roleId: quem.roleId,
        });
        await autenticado(token, 'post', `/users/${alvo.id}/regenerate-api-key`).expect(403);
      }
    });

    it('404 para usuário inexistente e para usuário soft-deletado', async () => {
      await autenticado(
        tokenAdmin,
        'post',
        '/users/00000000-0000-4000-8000-000000000000/regenerate-api-key',
      ).expect(404);

      const alvo = await criarUsuario(roleIdDriver);
      await autenticado(tokenAdmin, 'delete', `/users/${alvo.id}`).expect(204);
      await autenticado(tokenAdmin, 'post', `/users/${alvo.id}/regenerate-api-key`).expect(404);
    });
  });

  describe('POST /users com bloco driver', () => {
    it('DRIVER + driver cria User e Driver juntos', async () => {
      const cnh = novaCnh();
      const resposta = await autenticado(tokenAdmin, 'post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Motorista Atomico',
          roleId: roleIdDriver,
          driver: { licenseNumber: cnh, licenseExpiry: dataFutura() },
        })
        .expect(201);
      idsDeUsuarioParaLimpar.push(resposta.body.id);

      expect(resposta.body.driver.licenseNumber).toEqual(cnh);
      expect(resposta.body.driver.isActive).toBe(true);
      expect(resposta.body.password).toBeUndefined();

      const noBanco = await prisma.driver.findUnique({ where: { licenseNumber: cnh } });
      expect(noBanco?.userId).toEqual(resposta.body.id);
    });

    it('CNH inválida dá 400', async () => {
      await autenticado(tokenAdmin, 'post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Motorista CNH Ruim',
          roleId: roleIdDriver,
          driver: { licenseNumber: '123', licenseExpiry: dataFutura() },
        })
        .expect(400);
    });

    it('CNH duplicada dá 409 e nenhum User fica criado', async () => {
      const cnh = novaCnh();
      const primeiro = await autenticado(tokenAdmin, 'post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Motorista Um',
          roleId: roleIdDriver,
          driver: { licenseNumber: cnh, licenseExpiry: dataFutura() },
        })
        .expect(201);
      idsDeUsuarioParaLimpar.push(primeiro.body.id);

      const emailDuplicado = novoEmail();
      await autenticado(tokenAdmin, 'post', '/users')
        .send({
          email: emailDuplicado,
          password: SENHA,
          fullName: 'Motorista Dois',
          roleId: roleIdDriver,
          driver: { licenseNumber: cnh, licenseExpiry: dataFutura() },
        })
        .expect(409);

      const orfao = await prisma.user.findUnique({ where: { email: emailDuplicado } });
      expect(orfao).toBeNull();
    });

    it('driver com papel ADMIN ou FLEET_MANAGER dá 400', async () => {
      for (const roleId of [roleIdAdmin, roleIdFleetManager]) {
        const email = novoEmail();
        await autenticado(tokenAdmin, 'post', '/users')
          .send({
            email,
            password: SENHA,
            fullName: 'Papel Errado',
            roleId,
            driver: { licenseNumber: novaCnh(), licenseExpiry: dataFutura() },
          })
          .expect(400);
        expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      }
    });

    it('DRIVER sem o bloco driver dá 400 e nada é criado', async () => {
      const email = novoEmail();
      await autenticado(tokenAdmin, 'post', '/users')
        .send({ email, password: SENHA, fullName: 'Sem Bloco', roleId: roleIdDriver })
        .expect(400);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    });

    it('FLEET_MANAGER sem driver cria só a conta', async () => {
      const resposta = await criarUsuario(roleIdFleetManager);
      const motorista = await prisma.driver.findUnique({ where: { userId: resposta.id } });
      expect(motorista).toBeNull();
    });
  });

  describe('POST /drivers foi removido', () => {
    it('POST /drivers dá 404 (motorista só nasce em POST /users)', async () => {
      const usuario = await criarUsuario(roleIdFleetManager);
      await autenticado(tokenAdmin, 'post', '/drivers')
        .send({ userId: usuario.id, licenseNumber: novaCnh(), licenseExpiry: dataFutura() })
        .expect(404);
    });
  });
});
