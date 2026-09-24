import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';
import {
  criarUsuarioELogar,
  dataFutura,
  novaCnh,
  SENHA_PADRAO,
  UsuarioCriado,
} from './helpers/usuarios-e2e';

jest.setTimeout(90000);

// Cobre: POST /users (chave, papéis permitidos), USER_VIEW e PATCH /users/:id/role.
describe('Users: criação com API key, USER_VIEW e troca de role (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  let idAdmin: string;
  const roleIds: Record<string, string> = {};
  const idsParaLimpar: string[] = [];

  function autenticado(
    token: string,
    metodo: 'get' | 'post' | 'patch' | 'put' | 'delete',
    caminho: string,
  ) {
    return request(app.getHttpServer())
      [metodo](caminho)
      .set('Authorization', `Bearer ${token}`);
  }

  async function novoUsuario(nomeDoPapel: string): Promise<UsuarioCriado> {
    const usuario = await criarUsuarioELogar(
      app,
      prisma,
      tokenAdmin,
      nomeDoPapel,
      'e2e-crt',
      `Teste ${nomeDoPapel}`,
    );
    idsParaLimpar.push(usuario.id);
    return usuario;
  }

  function corpoDeUsuario(nomeDoPapel: string) {
    const corpo: Record<string, unknown> = {
      email: `e2e-crt-${randomBytes(6).toString('hex')}@test.local`,
      password: SENHA_PADRAO,
      fullName: `Criado ${nomeDoPapel}`,
      roleId: roleIds[nomeDoPapel],
    };
    if (nomeDoPapel === 'DRIVER') {
      corpo.driver = { licenseNumber: novaCnh(), licenseExpiry: dataFutura() };
    }
    return corpo;
  }

  function trocarRole(token: string, idAlvo: string, corpo: object) {
    return autenticado(token, 'patch', `/users/${idAlvo}/role`).send(corpo);
  }

  beforeAll(async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', process.env.ADMIN_API_KEY as string)
      .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_INITIAL_PASSWORD })
      .expect(200);
    tokenAdmin = login.body.accessToken;
    idAdmin = login.body.user.id;

    const papeis = await prisma.role.findMany();
    for (const papel of papeis) {
      roleIds[papel.name] = papel.id;
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.userPermission.deleteMany({ where: { userId: { in: idsParaLimpar } } });
      await prisma.driver.deleteMany({ where: { userId: { in: idsParaLimpar } } });
      await prisma.user.deleteMany({ where: { id: { in: idsParaLimpar } } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /users: chave e papéis permitidos', () => {
    it('ADMIN cria FLEET_MANAGER e ADMIN sem bloco driver (201) com apiKey', async () => {
      for (const nomeDoPapel of ['FLEET_MANAGER', 'ADMIN']) {
        const resposta = await autenticado(tokenAdmin, 'post', '/users')
          .send(corpoDeUsuario(nomeDoPapel))
          .expect(201);
        idsParaLimpar.push(resposta.body.id);
        expect(resposta.body.apiKey).toMatch(/^[0-9a-f]{64}$/);
        expect(resposta.headers['cache-control']).toEqual('no-store');
        const noBanco = await prisma.user.findUnique({ where: { id: resposta.body.id } });
        expect(noBanco?.apiKey).not.toBeNull();
      }
    });

    it('a apiKey devolvida loga o usuário novo e o banco guarda só o hash', async () => {
      const usuario = await novoUsuario('DRIVER');
      const noBanco = await prisma.user.findUnique({ where: { id: usuario.id } });
      expect(noBanco?.apiKey).not.toEqual(usuario.apiKey);
      expect(noBanco?.apiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(usuario.driverId).toBeDefined();
    });

    it('DRIVER sem bloco driver dá 400 e driver com outro papel dá 400', async () => {
      const semBloco = corpoDeUsuario('DRIVER');
      delete semBloco.driver;
      await autenticado(tokenAdmin, 'post', '/users').send(semBloco).expect(400);

      const comBlocoErrado = corpoDeUsuario('FLEET_MANAGER');
      comBlocoErrado.driver = { licenseNumber: novaCnh(), licenseExpiry: dataFutura() };
      await autenticado(tokenAdmin, 'post', '/users').send(comBlocoErrado).expect(400);
    });

    it('FLEET_MANAGER cria DRIVER (201) mas não FLEET_MANAGER nem ADMIN (403)', async () => {
      const gerente = await novoUsuario('FLEET_MANAGER');

      const criado = await autenticado(gerente.token, 'post', '/users')
        .send(corpoDeUsuario('DRIVER'))
        .expect(201);
      idsParaLimpar.push(criado.body.id);
      expect(criado.body.apiKey).toMatch(/^[0-9a-f]{64}$/);

      for (const nomeDoPapel of ['FLEET_MANAGER', 'ADMIN']) {
        const email = corpoDeUsuario(nomeDoPapel);
        await autenticado(gerente.token, 'post', '/users').send(email).expect(403);
        expect(await prisma.user.findUnique({ where: { email: email.email as string } })).toBeNull();
      }
    });

    it('DRIVER sem permission dá 403; com USER_CREATE delegado só cria DRIVER', async () => {
      const motorista = await novoUsuario('DRIVER');
      await autenticado(motorista.token, 'post', '/users')
        .send(corpoDeUsuario('DRIVER'))
        .expect(403);

      await autenticado(tokenAdmin, 'post', `/users/${motorista.id}/permissions`)
        .send({ permissionCode: 'USER_CREATE' })
        .expect(200);

      const criado = await autenticado(motorista.token, 'post', '/users')
        .send(corpoDeUsuario('DRIVER'))
        .expect(201);
      idsParaLimpar.push(criado.body.id);
      await autenticado(motorista.token, 'post', '/users')
        .send(corpoDeUsuario('FLEET_MANAGER'))
        .expect(403);
    });

    it('POST /drivers foi removido (404)', async () => {
      await autenticado(tokenAdmin, 'post', '/drivers').send({}).expect(404);
    });
  });

  describe('GET /users e GET /users/:id exigem USER_VIEW', () => {
    it('FLEET_MANAGER dá 403; com USER_VIEW delegado dá 200; ADMIN dá 200', async () => {
      const gerente = await novoUsuario('FLEET_MANAGER');
      await autenticado(gerente.token, 'get', '/users').expect(403);
      await autenticado(gerente.token, 'get', `/users/${gerente.id}`).expect(403);

      await autenticado(tokenAdmin, 'post', `/users/${gerente.id}/permissions`)
        .send({ permissionCode: 'USER_VIEW' })
        .expect(200);
      await autenticado(gerente.token, 'get', '/users').expect(200);
      await autenticado(gerente.token, 'get', `/users/${gerente.id}`).expect(200);

      await autenticado(tokenAdmin, 'get', '/users').expect(200);
    });
  });

  describe('PATCH /users/:id/role', () => {
    it('sobe DRIVER para FLEET_MANAGER (200) e mantém o perfil de motorista', async () => {
      const alvo = await novoUsuario('DRIVER');
      const resposta = await trocarRole(tokenAdmin, alvo.id, {
        roleId: roleIds.FLEET_MANAGER,
      }).expect(200);
      expect(resposta.body.roleId).toEqual(roleIds.FLEET_MANAGER);
      expect(resposta.body.apiKey).toBeUndefined();

      const motorista = await prisma.driver.findUnique({ where: { userId: alvo.id } });
      expect(motorista?.id).toEqual(alvo.driverId);
    });

    it('vale na hora para o JWT já emitido (DRIVER promovido a ADMIN passa a acessar GET /users)', async () => {
      const alvo = await novoUsuario('DRIVER');
      await autenticado(alvo.token, 'get', '/users').expect(403);

      await trocarRole(tokenAdmin, alvo.id, { roleId: roleIds.ADMIN }).expect(200);
      await autenticado(alvo.token, 'get', '/users').expect(200);
    });

    it('sobe FLEET_MANAGER para ADMIN (200)', async () => {
      const alvo = await novoUsuario('FLEET_MANAGER');
      const resposta = await trocarRole(tokenAdmin, alvo.id, { roleId: roleIds.ADMIN }).expect(200);
      expect(resposta.body.roleId).toEqual(roleIds.ADMIN);
    });

    it('descer de cargo dá 409 e a role não muda', async () => {
      const gerente = await novoUsuario('FLEET_MANAGER');
      const resposta = await trocarRole(tokenAdmin, gerente.id, { roleId: roleIds.DRIVER }).expect(409);
      expect(JSON.stringify(resposta.body)).toContain('Roles can only be raised');
      const noBanco = await prisma.user.findUnique({ where: { id: gerente.id } });
      expect(noBanco?.roleId).toEqual(roleIds.FLEET_MANAGER);
    });

    it('enviar o bloco driver dá 400 (não é mais aceito)', async () => {
      const alvo = await novoUsuario('DRIVER');
      await trocarRole(tokenAdmin, alvo.id, {
        roleId: roleIds.FLEET_MANAGER,
        driver: { licenseNumber: novaCnh(), licenseExpiry: dataFutura() },
      }).expect(400);
      const noBanco = await prisma.user.findUnique({ where: { id: alvo.id } });
      expect(noBanco?.roleId).toEqual(roleIds.DRIVER);
    });

    it('ADMIN não é rebaixado, nem por outro ADMIN (403)', async () => {
      const outroAdmin = await novoUsuario('ADMIN');
      await trocarRole(tokenAdmin, outroAdmin.id, { roleId: roleIds.FLEET_MANAGER }).expect(403);
      await trocarRole(tokenAdmin, outroAdmin.id, { roleId: roleIds.DRIVER }).expect(403);

      const noBanco = await prisma.user.findUnique({ where: { id: outroAdmin.id } });
      expect(noBanco?.roleId).toEqual(roleIds.ADMIN);
    });

    it('ninguém muda a própria role (409) e a mesma role dá 409', async () => {
      await trocarRole(tokenAdmin, idAdmin, { roleId: roleIds.FLEET_MANAGER }).expect(409);

      const alvo = await novoUsuario('FLEET_MANAGER');
      await trocarRole(tokenAdmin, alvo.id, { roleId: roleIds.FLEET_MANAGER }).expect(409);
    });

    it('roleId inexistente dá 400, usuário inexistente ou soft-deletado dá 404, corpo inválido dá 400', async () => {
      const alvo = await novoUsuario('FLEET_MANAGER');
      await trocarRole(tokenAdmin, alvo.id, { roleId: randomUUID() }).expect(400);
      await trocarRole(tokenAdmin, alvo.id, { roleId: 'nao-e-uuid' }).expect(400);
      await trocarRole(tokenAdmin, alvo.id, {}).expect(400);

      await trocarRole(tokenAdmin, randomUUID(), { roleId: roleIds.ADMIN }).expect(404);

      await autenticado(tokenAdmin, 'delete', `/users/${alvo.id}`).expect(204);
      await trocarRole(tokenAdmin, alvo.id, { roleId: roleIds.ADMIN }).expect(404);
    });

    it('FLEET_MANAGER e DRIVER dão 403 mesmo com as permissions de troca delegadas', async () => {
      const gerente = await novoUsuario('FLEET_MANAGER');
      const alvo = await novoUsuario('DRIVER');
      for (const permissionCode of ['USER_ROLE_PROMOTE']) {
        await autenticado(tokenAdmin, 'post', `/users/${gerente.id}/permissions`)
          .send({ permissionCode })
          .expect(200);
      }

      await trocarRole(gerente.token, alvo.id, { roleId: roleIds.FLEET_MANAGER }).expect(403);
      await trocarRole(alvo.token, gerente.id, { roleId: roleIds.ADMIN }).expect(403);

      const noBanco = await prisma.user.findUnique({ where: { id: alvo.id } });
      expect(noBanco?.roleId).toEqual(roleIds.DRIVER);
    });
  });
});
