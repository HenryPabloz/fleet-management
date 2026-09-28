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
import { dataFutura, novaCnh } from './helpers/usuarios-e2e';

const SENHA = 'SenhaForte123';

jest.setTimeout(60000);

describe('Auth com X-API-KEY (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicoJwt: JwtService;
  let tokenAdmin: string;
  let roleIdDriver: string;
  let chaveCorreta: string;

  // Só estes e-mails são apagados no fim.
  const emailsCriados: string[] = [];

  function novoEmail(): string {
    const email = `e2e-${randomBytes(6).toString('hex')}@test.local`;
    emailsCriados.push(email);
    return email;
  }

  // Sem "async": precisa devolver o próprio pedido para o chamador poder usar .expect().
  // O ADMIN cria o usuário (DRIVER) por POST /users; a autenticação usa a API_KEY fixa.
  function cadastrar(email: string) {
    return request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        email,
        password: SENHA,
        fullName: 'Usuario Teste',
        roleId: roleIdDriver,
        driver: { licenseNumber: novaCnh(), licenseExpiry: dataFutura() },
      });
  }

  function entrar(chave: string | undefined, corpo: object) {
    const requisicao = request(app.getHttpServer()).post('/auth/login');
    if (chave !== undefined) {
      requisicao.set('x-api-key', chave);
    }
    return requisicao.send(corpo);
  }

  beforeAll(async () => {
    chaveCorreta = process.env.API_KEY as string;

    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication();
    // Mesma validação global do main.ts.
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

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', chaveCorreta)
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      })
      .expect(200);
    tokenAdmin = loginAdmin.body.accessToken;
    const papelDriver = await prisma.role.findUnique({ where: { name: 'DRIVER' } });
    roleIdDriver = papelDriver?.id as string;
  });

  afterAll(async () => {
    if (prisma) {
      const criados = await prisma.user.findMany({
        where: { email: { in: emailsCriados } },
        select: { id: true },
      });
      const ids = criados.map((usuario) => usuario.id);
      await prisma.driver.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /users (não existe mais cadastro público)', () => {
    it('cria usuário sem devolver apiKey (a autenticação usa a chave fixa da aplicação)', async () => {
      const email = novoEmail();

      const resposta = await cadastrar(email).expect(201);

      expect(resposta.body.apiKey).toBeUndefined();
      expect(resposta.body.email).toEqual(email);
      expect(resposta.headers['cache-control']).toEqual('no-store');
      expect(resposta.body.password).toBeUndefined();

      const usuario = await prisma.user.findUnique({
        where: { email },
        include: { role: true },
      });
      expect(usuario?.password.startsWith('$2')).toBe(true);
      expect(usuario?.role.name).toEqual('DRIVER');
    });

    it('a mesma API_KEY da aplicação já permite o login do usuário novo', async () => {
      const email = novoEmail();
      await cadastrar(email).expect(201);
      const resposta = await entrar(chaveCorreta, { email, password: SENHA }).expect(200);
      expect(resposta.body.user.email).toEqual(email);
    });

    it('e-mail duplicado dá 409 (mesmo com maiúsculas e espaços)', async () => {
      const email = novoEmail();
      await cadastrar(email).expect(201);
      await cadastrar(email).expect(409);
      await cadastrar(`  ${email.toUpperCase()} `).expect(409);
    });

    it('recusa dados inválidos com 400 e não cria usuário', async () => {
      const servidor = request(app.getHttpServer());
      const corpoBom = {
        email: novoEmail(),
        password: SENHA,
        fullName: 'Usuario Teste',
        roleId: roleIdDriver,
        driver: { licenseNumber: novaCnh(), licenseExpiry: dataFutura() },
      };
      const enviar = (corpo: object) =>
        servidor
          .post('/users')
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send(corpo);

      await enviar({ ...corpoBom, password: 'curta' }).expect(400);
      await enviar({ ...corpoBom, email: 'nao-e-email' }).expect(400);
      await enviar({ ...corpoBom, password: 'a'.repeat(16) }).expect(400);
      await enviar({ ...corpoBom, fullName: '   ' }).expect(400);
      await enviar({ ...corpoBom, campoQueNaoExiste: 1 }).expect(400);
      await enviar({}).expect(400);

      const criado = await prisma.user.findUnique({
        where: { email: corpoBom.email },
      });
      expect(criado).toBeNull();
    });

    it('POST /auth/signup foi removido (404)', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ email: novoEmail(), password: SENHA, fullName: 'Usuario Teste' })
        .expect(404);
    });
  });

  describe('POST /auth/login (protegido por x-api-key, chave única e fixa)', () => {
    let email: string;

    beforeAll(async () => {
      email = novoEmail();
      await cadastrar(email).expect(201);
    });

    it('200 com chave certa e credenciais certas, devolve JWT sem segredos', async () => {
      const resposta = await entrar(chaveCorreta, {
        email: `  ${email.toUpperCase()} `,
        password: SENHA,
      }).expect(200);

      const carga = servicoJwt.decode(resposta.body.accessToken);
      expect(carga.email).toEqual(email);
      expect(carga.sub).toEqual(resposta.body.user.id);
      expect(carga.roleId).toBeDefined();
      expect(resposta.body.user.role).toEqual('DRIVER');

      const texto = JSON.stringify(resposta.body);
      expect(texto).not.toContain(chaveCorreta);
      expect(texto).not.toContain('$2');
      expect(resposta.body.user.apiKey).toBeUndefined();
      expect(resposta.body.user.password).toBeUndefined();
    });

    it('401 sem x-api-key', async () => {
      const resposta = await entrar(undefined, {
        email,
        password: SENHA,
      }).expect(401);
      expect(resposta.body.detail).toEqual('API key required');
    });

    it('401 com chave errada, mal formada ou repetida', async () => {
      const corpo = { email, password: SENHA };
      await entrar('a'.repeat(64), corpo).expect(401);
      await entrar('abc', corpo).expect(401);
      await entrar(chaveCorreta.toUpperCase(), corpo).expect(401);
      await entrar(`${chaveCorreta}, ${chaveCorreta}`, corpo).expect(401);
    });

    it('401 igual para senha errada e e-mail inexistente (mesma chave, todos os papéis)', async () => {
      const senhaErrada = await entrar(chaveCorreta, {
        email,
        password: 'OutraSenha123',
      }).expect(401);
      const emailInexistente = await entrar(chaveCorreta, {
        email: `nao-existe-${randomBytes(4).toString('hex')}@test.local`,
        password: SENHA,
      }).expect(401);

      expect(senhaErrada.body.detail).toEqual('Invalid credentials');
      expect(emailInexistente.body.detail).toEqual('Invalid credentials');
    });

    it('403 para usuário inativo, mesmo com a chave certa', async () => {
      const emailInativo = novoEmail();
      await cadastrar(emailInativo).expect(201);
      await prisma.user.update({
        where: { email: emailInativo },
        data: { isActive: false },
      });

      const resposta = await entrar(chaveCorreta, {
        email: emailInativo,
        password: SENHA,
      }).expect(403);
      expect(resposta.body.detail).toEqual('User account is inactive');
    });

    it('400 com corpo inválido (chave certa)', async () => {
      await entrar(chaveCorreta, { email, password: 'curta' }).expect(400);
      await entrar(chaveCorreta, { email, password: SENHA, extra: 1 }).expect(400);
    });
  });

  describe('A MESMA API_KEY vale para qualquer papel', () => {
    it('admin, fleet manager e driver logam todos com a chave da aplicação; chave errada falha para os três', async () => {
      const gerente = novoEmail();
      const papelGerente = await prisma.role.findUnique({ where: { name: 'FLEET_MANAGER' } });
      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          email: gerente,
          password: SENHA,
          fullName: 'Gerente Teste',
          roleId: papelGerente?.id,
        })
        .expect(201);

      const motorista = novoEmail();
      await cadastrar(motorista).expect(201);

      for (const email of [
        process.env.ADMIN_EMAIL as string,
        gerente,
        motorista,
      ]) {
        let senha = SENHA;
        if (email === process.env.ADMIN_EMAIL) {
          senha = process.env.ADMIN_INITIAL_PASSWORD as string;
        }
        await entrar(chaveCorreta, { email, password: senha }).expect(200);
        await entrar('chave-errada-0000000000000000000000000000000000000000000000000000', {
          email,
          password: senha,
        }).expect(401);
        await entrar(undefined, { email, password: senha }).expect(401);
      }
    });
  });

  describe('Rotas de regenerar API key não existem mais', () => {
    it('PATCH /auth/regenerate-key dá 404', async () => {
      await request(app.getHttpServer())
        .patch('/auth/regenerate-key')
        .set('x-api-key', chaveCorreta)
        .send({ password: SENHA })
        .expect(404);
    });

    it('POST /users/:id/regenerate-api-key dá 404', async () => {
      const email = novoEmail();
      const criado = await cadastrar(email).expect(201);
      await request(app.getHttpServer())
        .post(`/users/${criado.body.id}/regenerate-api-key`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(404);
    });
  });

  describe('JWT não vale na rota de x-api-key', () => {
    it('JWT em /auth/login dá 401 (falta x-api-key)', async () => {
      const email = novoEmail();
      await cadastrar(email).expect(201);
      const login = await entrar(chaveCorreta, { email, password: SENHA }).expect(200);
      const token: string = login.body.accessToken;

      await request(app.getHttpServer())
        .post('/auth/login')
        .set('Authorization', `Bearer ${token}`)
        .send({ email, password: SENHA })
        .expect(401);
    });
  });

  describe('Admin do seed', () => {
    it('faz login com a API_KEY da aplicação e ADMIN_INITIAL_PASSWORD', async () => {
      const resposta = await entrar(chaveCorreta, {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      }).expect(200);

      expect(resposta.body.user.role).toEqual('ADMIN');
      expect(resposta.body.accessToken).toBeDefined();
    });
  });
});
