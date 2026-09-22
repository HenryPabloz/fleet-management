import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';

const SENHA = 'SenhaForte123';

jest.setTimeout(60000);

describe('Soft delete: Users e Drivers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  let roleIdDriver: string;

  // Só estes ids são apagados de verdade no fim (limpeza do próprio teste).
  const idsDeUsuarioParaLimpar: string[] = [];

  function novoEmail(): string {
    return `e2e-soft-${randomBytes(6).toString('hex')}@test.local`;
  }

  function autenticado(metodo: 'get' | 'post' | 'patch' | 'put' | 'delete', caminho: string) {
    return request(app.getHttpServer())
      [metodo](caminho)
      .set('Authorization', `Bearer ${tokenAdmin}`);
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
    await app.init();

    prisma = app.get(PrismaService);

    // Login como o ADMIN do seed, igual ao teste de auth com x-api-key.
    const respostaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', process.env.ADMIN_API_KEY as string)
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      })
      .expect(200);
    tokenAdmin = respostaLogin.body.accessToken;

    const papelDriver = await prisma.role.findUnique({
      where: { name: 'DRIVER' },
    });
    if (!papelDriver) {
      throw new Error('Papel DRIVER não encontrado. O seed foi executado?');
    }
    roleIdDriver = papelDriver.id;
  });

  afterAll(async () => {
    if (prisma && idsDeUsuarioParaLimpar.length > 0) {
      // Apaga de verdade (driver antes de user, por causa da FK).
      await prisma.driver.deleteMany({
        where: { userId: { in: idsDeUsuarioParaLimpar } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: idsDeUsuarioParaLimpar } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('Users: ciclo completo de soft delete', () => {
    let idUsuario: string;

    it('POST /users cria um usuário ativo', async () => {
      const resposta = await autenticado('post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Usuario E2E Soft Delete',
          roleId: roleIdDriver,
        })
        .expect(201);

      idUsuario = resposta.body.id;
      idsDeUsuarioParaLimpar.push(idUsuario);
      expect(resposta.body.password).toBeUndefined();
      expect(resposta.body.apiKey).toBeUndefined();
    });

    it('GET /users lista o usuário criado (paginado)', async () => {
      const resposta = await autenticado('get', '/users?page=1&pageSize=100').expect(
        200,
      );

      expect(resposta.body.pagination).toEqual({
        page: 1,
        pageSize: 100,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
      const idsNaLista = resposta.body.data.map((item: { id: string }) => item.id);
      expect(idsNaLista).toContain(idUsuario);
    });

    it('DELETE /users/:id faz soft delete (some da listagem, deletedAt preenchido)', async () => {
      await autenticado('delete', `/users/${idUsuario}`).expect(204);

      const noBanco = await prisma.user.findUnique({ where: { id: idUsuario } });
      expect(noBanco?.deletedAt).not.toBeNull();

      await autenticado('get', `/users/${idUsuario}`).expect(404);

      const resposta = await autenticado('get', '/users?pageSize=100').expect(200);
      const idsNaLista = resposta.body.data.map((item: { id: string }) => item.id);
      expect(idsNaLista).not.toContain(idUsuario);
    });

    it('GET /users/deleted/all mostra o usuário removido (paginado)', async () => {
      const resposta = await autenticado(
        'get',
        '/users/deleted/all?page=1&pageSize=100',
      ).expect(200);

      expect(resposta.body.pagination.page).toEqual(1);
      expect(resposta.body.pagination.pageSize).toEqual(100);
      const idsNaLista = resposta.body.data.map((item: { id: string }) => item.id);
      expect(idsNaLista).toContain(idUsuario);
    });

    it('PATCH /users/:id/restore volta a aparecer na listagem normal', async () => {
      await autenticado('patch', `/users/${idUsuario}/restore`).expect(200);

      const noBanco = await prisma.user.findUnique({ where: { id: idUsuario } });
      expect(noBanco?.deletedAt).toBeNull();

      await autenticado('get', `/users/${idUsuario}`).expect(200);
    });

    it('DELETE /users/:id/permanent apaga de vez', async () => {
      await autenticado('delete', `/users/${idUsuario}`).expect(204);
      await autenticado('delete', `/users/${idUsuario}/permanent`).expect(204);

      const noBanco = await prisma.user.findUnique({ where: { id: idUsuario } });
      expect(noBanco).toBeNull();

      // Já foi embora de verdade, não precisa mais ser limpo no afterAll.
      const posicao = idsDeUsuarioParaLimpar.indexOf(idUsuario);
      if (posicao !== -1) {
        idsDeUsuarioParaLimpar.splice(posicao, 1);
      }
    });
  });

  describe('Drivers: ciclo completo de soft delete', () => {
    let idUsuarioDoDriver: string;
    let idDriver: string;

    beforeAll(async () => {
      const resposta = await autenticado('post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Motorista E2E Soft Delete',
          roleId: roleIdDriver,
        })
        .expect(201);
      idUsuarioDoDriver = resposta.body.id;
      idsDeUsuarioParaLimpar.push(idUsuarioDoDriver);
    });

    it('POST /drivers cria um motorista ativo', async () => {
      const dataFutura = new Date();
      dataFutura.setFullYear(dataFutura.getFullYear() + 1);

      const resposta = await autenticado('post', '/drivers')
        .send({
          userId: idUsuarioDoDriver,
          licenseNumber: `E2E${randomBytes(4).toString('hex')}`,
          licenseExpiry: dataFutura.toISOString(),
        })
        .expect(201);

      idDriver = resposta.body.id;
      expect(resposta.body.userId).toEqual(idUsuarioDoDriver);
    });

    it('GET /drivers lista o motorista criado (paginado)', async () => {
      const resposta = await autenticado('get', '/drivers?page=1&pageSize=100').expect(
        200,
      );

      expect(resposta.body.pagination.page).toEqual(1);
      const idsNaLista = resposta.body.data.map((item: { id: string }) => item.id);
      expect(idsNaLista).toContain(idDriver);
    });

    it('DELETE /drivers/:id faz soft delete', async () => {
      await autenticado('delete', `/drivers/${idDriver}`).expect(204);

      const noBanco = await prisma.driver.findUnique({ where: { id: idDriver } });
      expect(noBanco?.deletedAt).not.toBeNull();

      const resposta = await autenticado('get', '/drivers?pageSize=100').expect(200);
      const idsNaLista = resposta.body.data.map((item: { id: string }) => item.id);
      expect(idsNaLista).not.toContain(idDriver);
    });

    it('GET /drivers/deleted/all mostra o motorista removido (paginado)', async () => {
      const resposta = await autenticado(
        'get',
        '/drivers/deleted/all?page=1&pageSize=100',
      ).expect(200);

      expect(resposta.body.pagination.pageSize).toEqual(100);
      const idsNaLista = resposta.body.data.map((item: { id: string }) => item.id);
      expect(idsNaLista).toContain(idDriver);
    });

    it('PATCH /drivers/:id/restore volta a aparecer', async () => {
      await autenticado('patch', `/drivers/${idDriver}/restore`).expect(200);

      const noBanco = await prisma.driver.findUnique({ where: { id: idDriver } });
      expect(noBanco?.deletedAt).toBeNull();
    });

    it('DELETE /drivers/:id/permanent apaga de vez', async () => {
      await autenticado('delete', `/drivers/${idDriver}`).expect(204);
      await autenticado('delete', `/drivers/${idDriver}/permanent`).expect(204);

      const noBanco = await prisma.driver.findUnique({ where: { id: idDriver } });
      expect(noBanco).toBeNull();
    });
  });

  describe('Correções do QA: propagação User -> Driver, hard delete bloqueado, restore sem segredos', () => {
    let idUsuario: string;
    let idDriver: string;

    beforeAll(async () => {
      const resposta = await autenticado('post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Usuario E2E Correcoes QA',
          roleId: roleIdDriver,
        })
        .expect(201);
      idUsuario = resposta.body.id;
      idsDeUsuarioParaLimpar.push(idUsuario);

      const dataFutura = new Date();
      dataFutura.setFullYear(dataFutura.getFullYear() + 1);
      const respostaDriver = await autenticado('post', '/drivers')
        .send({
          userId: idUsuario,
          licenseNumber: `E2E${randomBytes(4).toString('hex')}`,
          licenseExpiry: dataFutura.toISOString(),
        })
        .expect(201);
      idDriver = respostaDriver.body.id;
    });

    it('DELETE /users/:id faz soft delete e propaga pro Driver vinculado', async () => {
      await autenticado('delete', `/users/${idUsuario}`).expect(204);

      const driverNoBanco = await prisma.driver.findUnique({ where: { id: idDriver } });
      expect(driverNoBanco?.deletedAt).not.toBeNull();

      const resposta = await autenticado('get', '/drivers?pageSize=100').expect(200);
      const idsNaLista = resposta.body.data.map((item: { id: string }) => item.id);
      expect(idsNaLista).not.toContain(idDriver);
    });

    it('PATCH /users/:id/restore NÃO restaura o Driver junto (assimetria proposital)', async () => {
      const resposta = await autenticado('patch', `/users/${idUsuario}/restore`).expect(200);

      const chaves = Object.keys(resposta.body);
      expect(chaves).not.toContain('password');
      expect(chaves).not.toContain('apiKey');
      expect(chaves).not.toContain('apiKeyCreatedAt');
      expect(chaves).not.toContain('apiKeyLastUsedAt');

      const driverNoBanco = await prisma.driver.findUnique({ where: { id: idDriver } });
      expect(driverNoBanco?.deletedAt).not.toBeNull();
    });

    it('DELETE /users/:id/permanent com Driver vinculado (mesmo soft-deletado) dá 409, nada é apagado', async () => {
      await autenticado('delete', `/users/${idUsuario}/permanent`).expect(409);

      const usuarioNoBanco = await prisma.user.findUnique({ where: { id: idUsuario } });
      expect(usuarioNoBanco).not.toBeNull();

      const driverNoBanco = await prisma.driver.findUnique({ where: { id: idDriver } });
      expect(driverNoBanco).not.toBeNull();
    });

    it('DELETE /users/:id/permanent sem Driver vinculado funciona normalmente (204)', async () => {
      // Apaga o driver antes: sem vínculo, o hard delete do usuário deve voltar a funcionar.
      await prisma.driver.delete({ where: { id: idDriver } });

      await autenticado('delete', `/users/${idUsuario}/permanent`).expect(204);

      const usuarioNoBanco = await prisma.user.findUnique({ where: { id: idUsuario } });
      expect(usuarioNoBanco).toBeNull();

      const posicao = idsDeUsuarioParaLimpar.indexOf(idUsuario);
      if (posicao !== -1) {
        idsDeUsuarioParaLimpar.splice(posicao, 1);
      }
    });
  });

  describe('Papéis sem permissão', () => {
    it('GET /users sem token dá 401', async () => {
      await request(app.getHttpServer()).get('/users').expect(401);
    });
  });
});
