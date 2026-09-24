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
const FORMATO_CHAVE = /^[0-9a-f]{64}$/;

jest.setTimeout(60000);

describe('Auth com X-API-KEY (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicoJwt: JwtService;
  let tokenAdmin: string;
  let roleIdDriver: string;

  // Só estes e-mails são apagados no fim.
  const emailsCriados: string[] = [];
  let dataUltimoUsoDoAdmin: Date | null = null;

  function novoEmail(): string {
    const email = `e2e-${randomBytes(6).toString('hex')}@test.local`;
    emailsCriados.push(email);
    return email;
  }

  // Sem "async": precisa devolver o próprio pedido para o chamador poder usar .expect().
  // O ADMIN cria o usuário (DRIVER) por POST /users; a resposta traz a apiKey.
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

  function regenerar(chave: string | undefined, senha: string | null = SENHA) {
    const requisicao = request(app.getHttpServer()).patch(
      '/auth/regenerate-key',
    );
    if (chave !== undefined) {
      requisicao.set('x-api-key', chave);
    }
    if (senha === null) {
      return requisicao.send({});
    }
    return requisicao.send({ password: senha });
  }

  beforeAll(async () => {
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
      .set('x-api-key', process.env.ADMIN_API_KEY as string)
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      })
      .expect(200);
    tokenAdmin = loginAdmin.body.accessToken;
    const papelDriver = await prisma.role.findUnique({ where: { name: 'DRIVER' } });
    roleIdDriver = papelDriver?.id as string;

    // Guarda o "último uso" do admin para devolver como estava.
    const admin = await prisma.user.findUnique({
      where: { email: process.env.ADMIN_EMAIL as string },
    });
    if (admin) {
      dataUltimoUsoDoAdmin = admin.apiKeyLastUsedAt;
    }
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
      await prisma.user.updateMany({
        where: { email: process.env.ADMIN_EMAIL as string },
        data: { apiKeyLastUsedAt: dataUltimoUsoDoAdmin },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /users gera a API key (não existe mais cadastro público)', () => {
    it('cria usuário, devolve chave única e grava só o hash (api_key nunca nulo)', async () => {
      const email1 = novoEmail();
      const email2 = novoEmail();

      const resposta1 = await cadastrar(email1).expect(201);
      const resposta2 = await cadastrar(email2).expect(201);

      expect(resposta1.body.apiKey).toMatch(FORMATO_CHAVE);
      expect(resposta2.body.apiKey).toMatch(FORMATO_CHAVE);
      expect(resposta1.body.apiKey).not.toEqual(resposta2.body.apiKey);
      expect(resposta1.body.email).toEqual(email1);
      expect(resposta1.headers['cache-control']).toEqual('no-store');
      expect(resposta1.body.password).toBeUndefined();

      const usuario = await prisma.user.findUnique({
        where: { email: email1 },
        include: { role: true },
      });
      expect(usuario?.apiKey).not.toBeNull();
      expect(usuario?.apiKey).not.toEqual(resposta1.body.apiKey);
      expect(usuario?.apiKey).toMatch(FORMATO_CHAVE);
      expect(usuario?.password.startsWith('$2')).toBe(true);
      expect(usuario?.role.name).toEqual('DRIVER');
      expect(usuario?.apiKeyCreatedAt).not.toBeNull();
      expect(usuario?.apiKeyLastUsedAt).toBeNull();
    });

    it('a chave devolvida já permite o login do usuário novo', async () => {
      const email = novoEmail();
      const criado = await cadastrar(email).expect(201);
      const resposta = await entrar(criado.body.apiKey, { email, password: SENHA }).expect(200);
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

  describe('POST /auth/login (protegido por x-api-key)', () => {
    let email: string;
    let chave: string;

    beforeAll(async () => {
      email = novoEmail();
      const resposta = await cadastrar(email).expect(201);
      chave = resposta.body.apiKey;
    });

    it('200 com chave e credenciais certas, devolve JWT sem segredos', async () => {
      const resposta = await entrar(chave, {
        email: `  ${email.toUpperCase()} `,
        password: SENHA,
      }).expect(200);

      const carga = servicoJwt.decode(resposta.body.accessToken);
      expect(carga.email).toEqual(email);
      expect(carga.sub).toEqual(resposta.body.user.id);
      expect(carga.roleId).toBeDefined();
      expect(resposta.body.user.role).toEqual('DRIVER');

      const texto = JSON.stringify(resposta.body);
      expect(texto).not.toContain(chave);
      expect(texto).not.toContain('$2');
      expect(resposta.body.user.apiKey).toBeUndefined();
      expect(resposta.body.user.password).toBeUndefined();

      // O uso da chave é registrado.
      const usuario = await prisma.user.findUnique({ where: { email } });
      expect(usuario?.apiKeyLastUsedAt).not.toBeNull();
    });

    it('401 sem x-api-key', async () => {
      const resposta = await entrar(undefined, {
        email,
        password: SENHA,
      }).expect(401);
      expect(resposta.body.detail).toEqual('API key required');
    });

    it('401 com chave inexistente, mal formada ou repetida', async () => {
      const corpo = { email, password: SENHA };
      await entrar('a'.repeat(64), corpo).expect(401);
      await entrar('abc', corpo).expect(401);
      await entrar(chave.toUpperCase(), corpo).expect(401);
      await entrar(`${chave}, ${chave}`, corpo).expect(401);
    });

    it('401 igual para senha errada e e-mail inexistente', async () => {
      const senhaErrada = await entrar(chave, {
        email,
        password: 'OutraSenha123',
      }).expect(401);
      const emailInexistente = await entrar(chave, {
        email: `nao-existe-${randomBytes(4).toString('hex')}@test.local`,
        password: SENHA,
      }).expect(401);

      expect(senhaErrada.body.detail).toEqual('Invalid credentials');
      expect(emailInexistente.body.detail).toEqual('Invalid credentials');
    });

    it('401 se a chave for de outro usuário', async () => {
      const outroEmail = novoEmail();
      const outro = await cadastrar(outroEmail).expect(201);

      // Chave do outro usuário com as credenciais (válidas) do primeiro.
      const resposta = await entrar(outro.body.apiKey, {
        email,
        password: SENHA,
      }).expect(401);
      expect(resposta.body.detail).toEqual('Invalid credentials');
    });

    it('403 para usuário inativo', async () => {
      const emailInativo = novoEmail();
      const inativo = await cadastrar(emailInativo).expect(201);
      await prisma.user.update({
        where: { email: emailInativo },
        data: { isActive: false },
      });

      const resposta = await entrar(inativo.body.apiKey, {
        email: emailInativo,
        password: SENHA,
      }).expect(403);
      expect(resposta.body.detail).toEqual('User account is inactive');
    });

    it('400 com corpo inválido (chave certa)', async () => {
      await entrar(chave, { email, password: 'curta' }).expect(400);
      await entrar(chave, { email, password: SENHA, extra: 1 }).expect(400);
    });
  });

  describe('PATCH /auth/regenerate-key', () => {
    it('gera nova chave, invalida a antiga e a nova funciona', async () => {
      const email = novoEmail();
      const cadastro = await cadastrar(email).expect(201);
      const chaveAntiga: string = cadastro.body.apiKey;
      const corpo = { email, password: SENHA };

      const resposta = await regenerar(chaveAntiga).expect(200);
      const chaveNova: string = resposta.body.newApiKey;

      expect(chaveNova).toMatch(FORMATO_CHAVE);
      expect(chaveNova).not.toEqual(chaveAntiga);
      expect(resposta.body.message).toEqual('Old key is now invalid');
      expect(resposta.headers['cache-control']).toEqual('no-store');

      await entrar(chaveAntiga, corpo).expect(401);
      await regenerar(chaveAntiga).expect(401);
      await entrar(chaveNova, corpo).expect(200);

      // No banco fica só o hash da chave nova.
      const usuario = await prisma.user.findUnique({ where: { email } });
      expect(usuario?.apiKey).not.toEqual(chaveNova);
      expect(usuario?.apiKey).toMatch(FORMATO_CHAVE);
    });

    it('401 sem x-api-key', async () => {
      await regenerar(undefined).expect(401);
    });

    it('400 sem password no corpo', async () => {
      const email = novoEmail();
      const cadastro = await cadastrar(email).expect(201);
      await regenerar(cadastro.body.apiKey, null).expect(400);
    });

    it('401 com senha errada e a chave NÃO muda', async () => {
      const email = novoEmail();
      const cadastro = await cadastrar(email).expect(201);
      const chave: string = cadastro.body.apiKey;

      await regenerar(chave, 'SenhaErrada99').expect(401);
      await entrar(chave, { email, password: SENHA }).expect(200);
    });

    it('JWT emitido antes continua valendo depois de trocar a chave', async () => {
      const email = novoEmail();
      const cadastro = await cadastrar(email).expect(201);
      const login = await entrar(cadastro.body.apiKey, {
        email,
        password: SENHA,
      }).expect(200);
      const token: string = login.body.accessToken;

      await regenerar(cadastro.body.apiKey).expect(200);
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('JWT não vale nas rotas de x-api-key', () => {
    it('JWT em /auth/login e em /auth/regenerate-key dá 401', async () => {
      const email = novoEmail();
      const cadastro = await cadastrar(email).expect(201);
      const login = await entrar(cadastro.body.apiKey, {
        email,
        password: SENHA,
      }).expect(200);
      const token: string = login.body.accessToken;

      await request(app.getHttpServer())
        .post('/auth/login')
        .set('Authorization', `Bearer ${token}`)
        .send({ email, password: SENHA })
        .expect(401);
      await request(app.getHttpServer())
        .patch('/auth/regenerate-key')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: SENHA })
        .expect(401);
    });
  });

  describe('Admin do seed', () => {
    it('faz login com ADMIN_API_KEY e ADMIN_INITIAL_PASSWORD', async () => {
      const resposta = await entrar(process.env.ADMIN_API_KEY as string, {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      }).expect(200);

      expect(resposta.body.user.role).toEqual('ADMIN');
      expect(resposta.body.accessToken).toBeDefined();
    });
  });
});
