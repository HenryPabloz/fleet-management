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

  function novaPlaca(): string {
    // Formato antigo (3 letras + 4 números), aceito pelo CHECK do banco e pelo @Matches do DTO.
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
    // 11 dígitos, formato exigido pelo @Matches do DTO.
    return randomBytes(6).readUIntBE(0, 6).toString().padStart(11, '0').slice(-11);
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
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
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
      // audit_logs é append-only (trigger do banco bloqueia DELETE/UPDATE nela).
      // Usuário com log de auditoria nunca pode ser apagado de vez: só dá pra soft-deletar.
      const registrosComAuditLog = await prisma.auditLog.findMany({
        where: { changedBy: { in: idsDeUsuarioParaLimpar } },
        select: { changedBy: true },
        distinct: ['changedBy'],
      });
      const idsParaSoftDelete = registrosComAuditLog.map((registro) => registro.changedBy);
      const idsParaApagarDeVez = idsDeUsuarioParaLimpar.filter(
        (id) => !idsParaSoftDelete.includes(id),
      );

      await prisma.driver.deleteMany({
        where: { userId: { in: idsDeUsuarioParaLimpar } },
      });
      if (idsParaSoftDelete.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: idsParaSoftDelete } },
          data: { deletedAt: new Date() },
        });
      }
      if (idsParaApagarDeVez.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: idsParaApagarDeVez } },
        });
      }
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
          fullName: 'Usuario Teste Soft Delete',
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
          fullName: 'Motorista Teste Soft Delete',
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
          licenseNumber: novaCnh(),
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
          fullName: 'Usuario Teste Correcoes QA',
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
          licenseNumber: novaCnh(),
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

  describe('Correções do QA: hard delete bloqueado por histórico de atividade (trips/audit_logs/etc)', () => {
    it('DELETE /users/:id/permanent de usuário que criou uma trip dá 409, nada quebra', async () => {
      const usuarioCriador = await autenticado('post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Usuario Teste Historico Trip',
          roleId: roleIdDriver,
        })
        .expect(201);
      const idUsuarioCriador = usuarioCriador.body.id;
      idsDeUsuarioParaLimpar.push(idUsuarioCriador);

      const usuarioMotorista = await autenticado('post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Motorista Teste Historico Trip',
          roleId: roleIdDriver,
        })
        .expect(201);
      const idUsuarioMotorista = usuarioMotorista.body.id;
      idsDeUsuarioParaLimpar.push(idUsuarioMotorista);

      const dataFutura = new Date();
      dataFutura.setFullYear(dataFutura.getFullYear() + 1);
      const driver = await autenticado('post', '/drivers')
        .send({
          userId: idUsuarioMotorista,
          licenseNumber: novaCnh(),
          licenseExpiry: dataFutura.toISOString(),
        })
        .expect(201);

      const veiculo = await prisma.vehicle.create({
        data: {
          plate: novaPlaca(),
          model: 'Fiat Strada',
          year: 2022,
          currentMileage: 1000,
          lastMaintenanceKm: 0,
        },
      });

      const trip = await prisma.trip.create({
        data: {
          driverId: driver.body.id,
          vehicleId: veiculo.id,
          status: 'PLANNED',
          startKm: veiculo.currentMileage,
          startLocation: 'São Paulo, SP',
          endLocation: 'Belo Horizonte, MG',
          createdBy: idUsuarioCriador,
        },
      });

      // Soft delete funciona normalmente; só o hard delete deve ficar bloqueado.
      await autenticado('delete', `/users/${idUsuarioCriador}`).expect(204);

      const resposta = await autenticado(
        'delete',
        `/users/${idUsuarioCriador}/permanent`,
      ).expect(409);
      expect(resposta.body.message).toContain('associated history');

      const usuarioNoBanco = await prisma.user.findUnique({
        where: { id: idUsuarioCriador },
      });
      expect(usuarioNoBanco).not.toBeNull();

      // Limpeza dos registros auxiliares criados só para este teste (o resto
      // do banco volta ao normal; audit_logs gerados ficam, são append-only).
      await prisma.trip.delete({ where: { id: trip.id } });
      await prisma.driver.delete({ where: { id: driver.body.id } });
      await prisma.vehicle.delete({ where: { id: veiculo.id } });

      // idUsuarioCriador tem um audit_log com fk_user_id apontando pra ele
      // (trigger da trip usa createdBy quando não há sessão): fica permanentemente
      // bloqueado pra hard delete, por design. Tira do array de limpeza forçada
      // do afterAll (senão o deleteMany bruto quebraria na mesma FK) e deixa
      // soft-deletado, igual ao residual esperado de audit_logs.
      const posicao = idsDeUsuarioParaLimpar.indexOf(idUsuarioCriador);
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
