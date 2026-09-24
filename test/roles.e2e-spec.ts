import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';

const SENHA = 'SenhaForte123';

jest.setTimeout(60000);

describe('GET /roles (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  let roleIdFleetManager: string;

  const idsDeUsuarioParaLimpar: string[] = [];

  function autenticado(metodo: 'get' | 'post', caminho: string, token: string) {
    return request(app.getHttpServer())
      [metodo](caminho)
      .set('Authorization', `Bearer ${token}`);
  }

  // /auth/signup cria DRIVER; para FLEET_MANAGER ajusta o papel via PATCH (ADMIN).
  async function criarUsuarioELogar(fleetManager: boolean) {
    const email = `e2e-roles-${randomBytes(6).toString('hex')}@test.local`;
    const cadastro = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: SENHA, fullName: 'Teste Roles' })
      .expect(201);
    const id = cadastro.body.userId as string;
    idsDeUsuarioParaLimpar.push(id);

    if (fleetManager) {
      await request(app.getHttpServer())
        .patch(`/users/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ roleId: roleIdFleetManager })
        .expect(200);
    }

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', cadastro.body.apiKey)
      .send({ email, password: SENHA })
      .expect(200);
    return { id, token: login.body.accessToken as string };
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
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      })
      .expect(200);
    tokenAdmin = login.body.accessToken;

    const papel = await prisma.role.findUnique({ where: { name: 'FLEET_MANAGER' } });
    if (!papel) {
      throw new Error('Papel FLEET_MANAGER não encontrado. O seed foi executado?');
    }
    roleIdFleetManager = papel.id;
  });

  afterAll(async () => {
    if (prisma && idsDeUsuarioParaLimpar.length > 0) {
      await prisma.userPermission.deleteMany({
        where: { userId: { in: idsDeUsuarioParaLimpar } },
      });
      await prisma.user.deleteMany({ where: { id: { in: idsDeUsuarioParaLimpar } } });
    }
    if (app) {
      await app.close();
    }
  });

  it('ADMIN recebe 200 com os 3 papéis, ordenados por nome, só com id/name/description', async () => {
    const resposta = await autenticado('get', '/roles', tokenAdmin).expect(200);
    const noBanco = await prisma.role.findMany();

    expect(resposta.body).toHaveLength(3);
    expect(resposta.body.map((r: { id: string }) => r.id).sort()).toEqual(
      noBanco.map((r) => r.id).sort(),
    );
    const nomes = resposta.body.map((r: { name: string }) => r.name);
    expect(nomes).toEqual([...nomes].sort());
    for (const papel of resposta.body) {
      expect(Object.keys(papel).sort()).toEqual(['description', 'id', 'name']);
    }
  });

  it('FLEET_MANAGER sem concessão recebe 403', async () => {
    const gerente = await criarUsuarioELogar(true);
    await autenticado('get', '/roles', gerente.token).expect(403);
  });

  it('FLEET_MANAGER com USER_CREATE concedido recebe 200', async () => {
    const gerente = await criarUsuarioELogar(true);
    await autenticado('post', `/users/${gerente.id}/permissions`, tokenAdmin)
      .send({ permissionCode: 'USER_CREATE' })
      .expect(200);
    const resposta = await autenticado('get', '/roles', gerente.token).expect(200);
    expect(resposta.body).toHaveLength(3);
  });

  it('DRIVER recebe 403', async () => {
    const motorista = await criarUsuarioELogar(false);
    await autenticado('get', '/roles', motorista.token).expect(403);
  });

  it('sem token recebe 401', async () => {
    await request(app.getHttpServer()).get('/roles').expect(401);
  });
});
