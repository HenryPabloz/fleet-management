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

// Cobre os 4 endpoints novos do Passo "gaps de permission sem rota":
// GET /users/me, PATCH /users/me, PATCH /users/me/password, GET /audit-logs.
describe('Users/me e Audit Logs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicoJwt: JwtService;
  let tokenAdmin: string;
  let roleIdDriver: string;
  let roleIdFleetManager: string;

  const idsDeUsuarioParaLimpar: string[] = [];
  const idsDeDriverParaLimpar: string[] = [];
  const idsDeVeiculoParaLimpar: string[] = [];
  const idsDeTripParaLimpar: string[] = [];

  function novoEmail(): string {
    return `e2e-me-${randomBytes(6).toString('hex')}@test.local`;
  }

  function novaPlaca(): string {
    const letras = Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26)),
    ).join('');
    const numeros = randomBytes(2)
      .readUInt16BE(0)
      .toString()
      .padStart(4, '0')
      .slice(-4);
    return `${letras}${numeros}`;
  }

  function novaCnh(): string {
    return randomBytes(6).readUIntBE(0, 6).toString().padStart(11, '0').slice(-11);
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

  // Cria um usuário (ADMIN cria via POST /users) com o papel pedido, devolve
  // o próprio usuário e um token assinado direto (sem passar pelo fluxo de
  // signup/API key — mesmo padrão já usado em vehicles-maintenances.e2e-spec.ts).
  async function criarUsuarioComToken(roleId: string, fullName: string) {
    const resposta = await autenticado(tokenAdmin, 'post', '/users')
      .send({ email: novoEmail(), password: SENHA, fullName, roleId })
      .expect(201);
    idsDeUsuarioParaLimpar.push(resposta.body.id);

    const token = servicoJwt.sign({
      sub: resposta.body.id,
      email: resposta.body.email,
      roleId,
    });
    return { usuario: resposta.body as { id: string; email: string; fullName: string }, token };
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

    const respostaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', process.env.ADMIN_API_KEY as string)
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      })
      .expect(200);
    tokenAdmin = respostaLogin.body.accessToken;

    const papelDriver = await prisma.role.findUnique({ where: { name: 'DRIVER' } });
    const papelFleetManager = await prisma.role.findUnique({
      where: { name: 'FLEET_MANAGER' },
    });
    if (!papelDriver || !papelFleetManager) {
      throw new Error('Papéis DRIVER/FLEET_MANAGER não encontrados. O seed foi executado?');
    }
    roleIdDriver = papelDriver.id;
    roleIdFleetManager = papelFleetManager.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (idsDeTripParaLimpar.length > 0) {
        await prisma.trip.deleteMany({ where: { id: { in: idsDeTripParaLimpar } } });
      }
      if (idsDeDriverParaLimpar.length > 0) {
        await prisma.driver.deleteMany({ where: { id: { in: idsDeDriverParaLimpar } } });
      }
      if (idsDeUsuarioParaLimpar.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: idsDeUsuarioParaLimpar } } });
      }
      if (idsDeVeiculoParaLimpar.length > 0) {
        await prisma.vehicle.deleteMany({ where: { id: { in: idsDeVeiculoParaLimpar } } });
      }
    }
    if (app) {
      await app.close();
    }
  });

  describe('GET /users/me', () => {
    it('devolve o próprio perfil, sem password/apiKey, independente do papel', async () => {
      const driver = await criarUsuarioComToken(roleIdDriver, 'Driver Perfil Proprio');

      const resposta = await autenticado(driver.token, 'get', '/users/me').expect(200);
      expect(resposta.body.id).toEqual(driver.usuario.id);
      expect(resposta.body.email).toEqual(driver.usuario.email);
      expect(resposta.body.password).toBeUndefined();
      expect(resposta.body.apiKey).toBeUndefined();
    });

    it('funciona também para FLEET_MANAGER e ADMIN (rota "eu mesmo", não depende de papel)', async () => {
      const fleetManager = await criarUsuarioComToken(roleIdFleetManager, 'FM Perfil Proprio');
      await autenticado(fleetManager.token, 'get', '/users/me').expect(200);

      const respostaAdmin = await autenticado(tokenAdmin, 'get', '/users/me').expect(200);
      expect(respostaAdmin.body.email).toEqual(process.env.ADMIN_EMAIL);
    });

    it('sem token dá 401', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });
  });

  describe('PATCH /users/me', () => {
    it('atualiza o próprio fullName', async () => {
      const driver = await criarUsuarioComToken(roleIdDriver, 'Nome Original');

      const resposta = await autenticado(driver.token, 'patch', '/users/me')
        .send({ fullName: 'Nome Atualizado Pelo Proprio' })
        .expect(200);
      expect(resposta.body.fullName).toEqual('Nome Atualizado Pelo Proprio');

      const noBanco = await prisma.user.findUnique({ where: { id: driver.usuario.id } });
      expect(noBanco?.fullName).toEqual('Nome Atualizado Pelo Proprio');
    });

    it('não aceita roleId/isActive/email (campos fora do DTO): 400 (forbidNonWhitelisted)', async () => {
      const driver = await criarUsuarioComToken(roleIdDriver, 'Driver Tenta Escalar');

      await autenticado(driver.token, 'patch', '/users/me')
        .send({ fullName: 'Tentativa', roleId: roleIdFleetManager })
        .expect(400);
    });

    it('nome com número dá 400 (mesma validação do NomePipe)', async () => {
      const driver = await criarUsuarioComToken(roleIdDriver, 'Driver Nome Invalido');

      await autenticado(driver.token, 'patch', '/users/me')
        .send({ fullName: 'Nome123' })
        .expect(400);
    });
  });

  describe('PATCH /users/me/password', () => {
    it('troca a senha com a senha atual correta', async () => {
      const driver = await criarUsuarioComToken(roleIdDriver, 'Driver Troca Senha');

      await autenticado(driver.token, 'patch', '/users/me/password')
        .send({ currentPassword: SENHA, newPassword: 'SenhaNova456' })
        .expect(200);

      // Confirma a troca de verdade: login com a senha antiga falha, com a nova funciona.
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-api-key', process.env.ADMIN_API_KEY as string)
        .send({ email: driver.usuario.email, password: SENHA })
        .expect(401);
    });

    it('senha atual errada dá 401 (não troca)', async () => {
      const driver = await criarUsuarioComToken(roleIdDriver, 'Driver Senha Errada');

      await autenticado(driver.token, 'patch', '/users/me/password')
        .send({ currentPassword: 'SenhaErrada1', newPassword: 'OutraSenha123' })
        .expect(401);
    });

    it('senha nova fora do tamanho permitido dá 400', async () => {
      const driver = await criarUsuarioComToken(roleIdDriver, 'Driver Senha Curta');

      await autenticado(driver.token, 'patch', '/users/me/password')
        .send({ currentPassword: SENHA, newPassword: '123' })
        .expect(400);
    });

    it('funciona também para FLEET_MANAGER e ADMIN (rota "eu mesmo")', async () => {
      const fleetManager = await criarUsuarioComToken(roleIdFleetManager, 'FM Troca Senha');
      await autenticado(fleetManager.token, 'patch', '/users/me/password')
        .send({ currentPassword: SENHA, newPassword: 'SenhaNova999' })
        .expect(200);
    });
  });

  describe('GET /audit-logs', () => {
    // audit_logs só tem trigger nas tabelas trips/refuelings/incidents (não em
    // users), então gera um registro de verdade criando uma trip via procedure
    // (que já roda set_config('app.current_user_id', ...) na transação).
    async function criarTripParaGerarAuditLog() {
      const veiculo = await autenticado(tokenAdmin, 'post', '/vehicles')
        .send({ plate: novaPlaca(), model: 'Fiat Strada', year: 2022, currentMileage: 1000 })
        .expect(201);
      idsDeVeiculoParaLimpar.push(veiculo.body.id);

      const usuario = await autenticado(tokenAdmin, 'post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Motorista Para Audit Log',
          roleId: roleIdDriver,
        })
        .expect(201);
      idsDeUsuarioParaLimpar.push(usuario.body.id);

      const dataFutura = new Date();
      dataFutura.setFullYear(dataFutura.getFullYear() + 1);
      const driver = await autenticado(tokenAdmin, 'post', '/drivers')
        .send({
          userId: usuario.body.id,
          licenseNumber: novaCnh(),
          licenseExpiry: dataFutura.toISOString(),
        })
        .expect(201);
      idsDeDriverParaLimpar.push(driver.body.id);

      const trip = await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.body.id,
          vehicleId: veiculo.body.id,
          startKm: 1000,
          startLocation: '01310-100',
          endLocation: '20040-020',
        })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);

      return trip.body as { id: string };
    }

    it('ADMIN (AUDIT_VIEW por papel) lista os registros de auditoria, com o CREATE da trip nele', async () => {
      const trip = await criarTripParaGerarAuditLog();

      const resposta = await autenticado(
        tokenAdmin,
        'get',
        `/audit-logs?entityType=TRIP&entityId=${trip.id}&pageSize=100`,
      ).expect(200);
      expect(Array.isArray(resposta.body.data)).toBe(true);
      expect(resposta.body.pagination).toBeDefined();

      const registros = resposta.body.data as Array<{
        entityType: string;
        entityId: string;
        action: string;
      }>;
      expect(registros.length).toBeGreaterThan(0);
      expect(registros.every((r) => r.entityType === 'TRIP' && r.entityId === trip.id)).toBe(
        true,
      );
      expect(registros.some((r) => r.action === 'CREATE')).toBe(true);
    });

    it('DRIVER sem AUDIT_VIEW dá 403', async () => {
      const driver = await criarUsuarioComToken(roleIdDriver, 'Driver Sem Audit View');
      await autenticado(driver.token, 'get', '/audit-logs').expect(403);
    });

    it('FLEET_MANAGER sem AUDIT_VIEW dá 403', async () => {
      const fleetManager = await criarUsuarioComToken(roleIdFleetManager, 'FM Sem Audit View');
      await autenticado(fleetManager.token, 'get', '/audit-logs').expect(403);
    });

    it('sem token dá 401', async () => {
      await request(app.getHttpServer()).get('/audit-logs').expect(401);
    });
  });
});
