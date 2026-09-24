import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';

const SENHA = 'SenhaForte123';
const RECURSOS = [
  'users',
  'drivers',
  'vehicles',
  'trips',
  'refuelings',
  'maintenances',
  'incidents',
];

jest.setTimeout(60000);

// Deleção total (/permanent) é exclusiva do ADMIN nos 7 recursos.
describe('Hard delete só ADMIN (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  let tokenGerente: string;
  let tokenMotorista: string;
  const idsDeUsuarioParaLimpar: string[] = [];

  function autenticado(token: string, caminho: string) {
    return request(app.getHttpServer())
      .delete(caminho)
      .set('Authorization', `Bearer ${token}`);
  }

  // Cria via signup (sempre DRIVER) e, se pedido, promove a FLEET_MANAGER.
  async function criarUsuarioELogar(nomeDoPapel: string) {
    const email = `e2e-hd-${randomBytes(6).toString('hex')}@test.local`;
    const cadastro = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: SENHA, fullName: `Teste ${nomeDoPapel}` })
      .expect(201);
    const id = cadastro.body.userId as string;
    idsDeUsuarioParaLimpar.push(id);

    if (nomeDoPapel !== 'DRIVER') {
      const papel = await prisma.role.findUnique({ where: { name: nomeDoPapel } });
      await request(app.getHttpServer())
        .patch(`/users/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ roleId: papel?.id })
        .expect(200);
    }

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', cadastro.body.apiKey)
      .send({ email, password: SENHA })
      .expect(200);
    return login.body.accessToken as string;
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

    tokenGerente = await criarUsuarioELogar('FLEET_MANAGER');
    tokenMotorista = await criarUsuarioELogar('DRIVER');
  });

  afterAll(async () => {
    // Historico de auditoria nao bloqueia mais a delecao total do usuario.
    await prisma.user.deleteMany({ where: { id: { in: idsDeUsuarioParaLimpar } } });
    await app.close();
  });

  for (const recurso of RECURSOS) {
    describe(`DELETE /${recurso}/:id/permanent`, () => {
      it('FLEET_MANAGER recebe 403', async () => {
        await autenticado(tokenGerente, `/${recurso}/${randomUUID()}/permanent`).expect(403);
      });

      it('DRIVER recebe 403', async () => {
        await autenticado(tokenMotorista, `/${recurso}/${randomUUID()}/permanent`).expect(403);
      });

      it('ADMIN passa do guard (404 para id inexistente, não 403)', async () => {
        await autenticado(tokenAdmin, `/${recurso}/${randomUUID()}/permanent`).expect(404);
      });
    });
  }
});
