import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';
import { criarUsuarioELogar } from './helpers/usuarios-e2e';

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

  // O ADMIN cria o usuário por POST /users e loga com a apiKey devolvida.
  async function criarUsuarioELogarComToken(nomeDoPapel: string) {
    const usuario = await criarUsuarioELogar(app, prisma, tokenAdmin, nomeDoPapel, 'e2e-hd', `Teste ${nomeDoPapel}`);
    idsDeUsuarioParaLimpar.push(usuario.id);
    return usuario.token;
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

    tokenGerente = await criarUsuarioELogarComToken('FLEET_MANAGER');
    tokenMotorista = await criarUsuarioELogarComToken('DRIVER');
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
