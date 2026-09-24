import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';
import { criarUsuarioELogar, UsuarioCriado } from './helpers/usuarios-e2e';

jest.setTimeout(120000);

// Cobre: roleId fora de PATCH /users/:id, IDOR em refuelings/incidents/trips
// (leitura e escrita) e permissions/driverId em /users/me e no login.
describe('Segurança R4: roleId, IDOR e dados do usuário logado (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  const roleIds: Record<string, string> = {};
  const idsUsuarios: string[] = [];
  const idsVeiculos: string[] = [];
  const idsTrips: string[] = [];
  const idsRefuelings: string[] = [];
  const idsIncidents: string[] = [];

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
      'e2e-r4',
      `Teste Quatro ${nomeDoPapel}`,
    );
    idsUsuarios.push(usuario.id);
    return usuario;
  }

  async function novoVeiculo() {
    const letras = Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26)),
    ).join('');
    const numeros = randomBytes(2).readUInt16BE(0).toString().padStart(4, '0').slice(-4);
    const resposta = await autenticado(tokenAdmin, 'post', '/vehicles')
      .send({ plate: `${letras}${numeros}`, model: 'Fiat Strada', year: 2022, currentMileage: 1000 })
      .expect(201);
    idsVeiculos.push(resposta.body.id);
    return resposta.body;
  }

  async function novaViagem(driverId: string) {
    const veiculo = await novoVeiculo();
    const resposta = await autenticado(tokenAdmin, 'post', '/trips')
      .send({
        driverId,
        vehicleId: veiculo.id,
        startLocation: '01310-100',
        endLocation: '20040-020',
      })
      .expect(201);
    idsTrips.push(resposta.body.id);
    return { viagem: resposta.body, veiculo };
  }

  async function novoAbastecimento(driverId: string) {
    const veiculo = await novoVeiculo();
    const resposta = await autenticado(tokenAdmin, 'post', '/refuelings')
      .send({
        vehicleId: veiculo.id,
        driverId,
        mileage: 1050,
        litersAdded: 20,
        costPerLiter: 5,
        fuelType: 'DIESEL',
      })
      .expect(201);
    idsRefuelings.push(resposta.body.id);
    return resposta.body;
  }

  async function novoIncidente(driverId: string) {
    const veiculo = await novoVeiculo();
    const resposta = await autenticado(tokenAdmin, 'post', '/incidents')
      .field('vehicleId', veiculo.id)
      .field('driverId', driverId)
      .field('type', 'MECHANICAL_FAILURE')
      .field('severity', 'LOW')
      .field('description', 'Incidente de teste R4')
      .expect(201);
    idsIncidents.push(resposta.body.id);
    return resposta.body;
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

    const papeis = await prisma.role.findMany();
    for (const papel of papeis) {
      roleIds[papel.name] = papel.id;
    }
  });

  afterAll(async () => {
    if (prisma) {
      for (const id of idsIncidents) {
        await autenticado(tokenAdmin, 'delete', `/incidents/${id}`).catch(() => undefined);
        await autenticado(tokenAdmin, 'delete', `/incidents/${id}/permanent`).catch(
          () => undefined,
        );
      }
      await prisma.refueling.deleteMany({ where: { id: { in: idsRefuelings } } });
      await prisma.trip.deleteMany({ where: { id: { in: idsTrips } } });
      await prisma.userPermission.deleteMany({ where: { userId: { in: idsUsuarios } } });
      await prisma.driver.deleteMany({ where: { userId: { in: idsUsuarios } } });
      await prisma.user.deleteMany({ where: { id: { in: idsUsuarios } } });
      await prisma.vehicle.deleteMany({ where: { id: { in: idsVeiculos } } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('A. roleId não é aceito em PATCH /users/:id', () => {
    it('PATCH /users/:id com roleId dá 400 e a role não muda', async () => {
      const alvo = await novoUsuario('DRIVER');
      await autenticado(tokenAdmin, 'patch', `/users/${alvo.id}`)
        .send({ roleId: roleIds['ADMIN'] })
        .expect(400);
      const noBanco = await prisma.user.findUnique({ where: { id: alvo.id } });
      expect(noBanco?.roleId).toEqual(roleIds['DRIVER']);
    });

    it('ADMIN não rebaixa outro ADMIN por nenhum caminho (role 403, PATCH com roleId 400)', async () => {
      const outroAdmin = await novoUsuario('ADMIN');
      const admin2 = await novoUsuario('ADMIN');

      await autenticado(admin2.token, 'patch', `/users/${outroAdmin.id}/role`)
        .send({ roleId: roleIds['DRIVER'] })
        .expect(403);
      await autenticado(admin2.token, 'patch', `/users/${outroAdmin.id}`)
        .send({ roleId: roleIds['DRIVER'] })
        .expect(400);

      const noBanco = await prisma.user.findUnique({ where: { id: outroAdmin.id } });
      expect(noBanco?.roleId).toEqual(roleIds['ADMIN']);
    });

    it('FLEET_MANAGER com USER_UPDATE delegado não consegue se promover', async () => {
      const gerente = await novoUsuario('FLEET_MANAGER');
      await autenticado(tokenAdmin, 'post', `/users/${gerente.id}/permissions`)
        .send({ permissionCode: 'USER_UPDATE' })
        .expect(200);

      await autenticado(gerente.token, 'patch', `/users/${gerente.id}`)
        .send({ roleId: roleIds['ADMIN'] })
        .expect(400);

      const noBanco = await prisma.user.findUnique({ where: { id: gerente.id } });
      expect(noBanco?.roleId).toEqual(roleIds['FLEET_MANAGER']);
    });
  });

  describe('B. motorista só acessa e escreve no que é dele', () => {
    let motoristaA: UsuarioCriado;
    let motoristaB: UsuarioCriado;
    let gerente: UsuarioCriado;

    beforeAll(async () => {
      motoristaA = await novoUsuario('DRIVER');
      motoristaB = await novoUsuario('DRIVER');
      gerente = await novoUsuario('FLEET_MANAGER');
    });

    it('GET /refuelings/:id: dono 200, outro motorista 404, ADMIN e FLEET_MANAGER 200', async () => {
      const abastecimento = await novoAbastecimento(motoristaA.driverId as string);
      await autenticado(motoristaA.token, 'get', `/refuelings/${abastecimento.id}`).expect(200);
      await autenticado(motoristaB.token, 'get', `/refuelings/${abastecimento.id}`).expect(404);
      await autenticado(tokenAdmin, 'get', `/refuelings/${abastecimento.id}`).expect(200);
      await autenticado(gerente.token, 'get', `/refuelings/${abastecimento.id}`).expect(200);
    });

    it('GET /incidents/:id: dono 200, outro motorista 404, ADMIN e FLEET_MANAGER 200', async () => {
      const incidente = await novoIncidente(motoristaA.driverId as string);
      await autenticado(motoristaA.token, 'get', `/incidents/${incidente.id}`).expect(200);
      await autenticado(motoristaB.token, 'get', `/incidents/${incidente.id}`).expect(404);
      await autenticado(tokenAdmin, 'get', `/incidents/${incidente.id}`).expect(200);
      await autenticado(gerente.token, 'get', `/incidents/${incidente.id}`).expect(200);
    });

    it('GET /trips/:id: dono 200, outro motorista 404', async () => {
      const { viagem } = await novaViagem(motoristaA.driverId as string);
      await autenticado(motoristaA.token, 'get', `/trips/${viagem.id}`).expect(200);
      await autenticado(motoristaB.token, 'get', `/trips/${viagem.id}`).expect(404);
    });

    it('start/end/cancel de viagem alheia dão 404 e a viagem não muda', async () => {
      const dono = await novoUsuario('DRIVER');
      const { viagem } = await novaViagem(dono.driverId as string);
      await autenticado(motoristaB.token, 'patch', `/trips/${viagem.id}/start`)
        .send({ currentMileage: 1100 })
        .expect(404);
      await autenticado(motoristaB.token, 'patch', `/trips/${viagem.id}/end`)
        .send({ endMileage: 1200, endLocation: '01310-100' })
        .expect(404);
      await autenticado(motoristaB.token, 'patch', `/trips/${viagem.id}/cancel`).expect(404);

      const noBanco = await prisma.trip.findUnique({ where: { id: viagem.id } });
      expect(noBanco?.status).toEqual('PLANNED');
    });

    it('motorista opera a própria viagem (start e cancel) normalmente', async () => {
      const dono = await novoUsuario('DRIVER');
      const { viagem } = await novaViagem(dono.driverId as string);
      const iniciada = await autenticado(dono.token, 'patch', `/trips/${viagem.id}/start`)
        .send({ currentMileage: 1100 })
        .expect(200);
      expect(iniciada.body.status).toEqual('IN_PROGRESS');

      // Outro dono cancela a própria viagem ainda PLANNED.
      const dono2 = await novoUsuario('DRIVER');
      const outra = await novaViagem(dono2.driverId as string);
      await autenticado(dono2.token, 'patch', `/trips/${outra.viagem.id}/cancel`).expect(200);
    });

    it('POST /trips, /refuelings e /incidents com driverId alheio dão 403', async () => {
      const veiculo = await novoVeiculo();
      await autenticado(motoristaB.token, 'post', '/trips')
        .send({
          driverId: motoristaA.driverId,
          vehicleId: veiculo.id,
          startLocation: '01310-100',
          endLocation: '20040-020',
        })
        .expect(403);
      await autenticado(motoristaB.token, 'post', '/refuelings')
        .send({
          vehicleId: veiculo.id,
          driverId: motoristaA.driverId,
          mileage: 1050,
          litersAdded: 20,
          costPerLiter: 5,
          fuelType: 'DIESEL',
        })
        .expect(403);
      await autenticado(motoristaB.token, 'post', '/incidents')
        .field('vehicleId', veiculo.id)
        .field('driverId', motoristaA.driverId as string)
        .field('type', 'MECHANICAL_FAILURE')
        .field('severity', 'LOW')
        .field('description', 'Tentativa em nome de outro motorista')
        .expect(403);
    });

    it('motorista cria trip, refueling e incident com o próprio driverId (201)', async () => {
      const veiculo = await novoVeiculo();
      const viagem = await autenticado(motoristaB.token, 'post', '/trips')
        .send({
          driverId: motoristaB.driverId,
          vehicleId: veiculo.id,
          startLocation: '01310-100',
          endLocation: '20040-020',
        })
        .expect(201);
      idsTrips.push(viagem.body.id);

      const veiculo2 = await novoVeiculo();
      const abastecimento = await autenticado(motoristaB.token, 'post', '/refuelings')
        .send({
          vehicleId: veiculo2.id,
          driverId: motoristaB.driverId,
          mileage: 1050,
          litersAdded: 20,
          costPerLiter: 5,
          fuelType: 'DIESEL',
        })
        .expect(201);
      idsRefuelings.push(abastecimento.body.id);

      const incidente = await autenticado(motoristaB.token, 'post', '/incidents')
        .field('vehicleId', veiculo2.id)
        .field('driverId', motoristaB.driverId as string)
        .field('type', 'MECHANICAL_FAILURE')
        .field('severity', 'LOW')
        .field('description', 'Incidente do próprio motorista')
        .expect(201);
      idsIncidents.push(incidente.body.id);
    });

    it('ADMIN e FLEET_MANAGER criam em nome de qualquer motorista (201)', async () => {
      const outroMotorista = await novoUsuario('DRIVER');
      const veiculo = await novoVeiculo();
      const viagem = await autenticado(gerente.token, 'post', '/trips')
        .send({
          driverId: outroMotorista.driverId,
          vehicleId: veiculo.id,
          startLocation: '01310-100',
          endLocation: '20040-020',
        })
        .expect(201);
      idsTrips.push(viagem.body.id);
    });
  });

  describe('C. permissions e driverId em /users/me e no login', () => {
    it('GET /users/me do DRIVER traz permissions do papel e o driverId', async () => {
      const motorista = await novoUsuario('DRIVER');
      const resposta = await autenticado(motorista.token, 'get', '/users/me').expect(200);
      expect(resposta.body.driverId).toEqual(motorista.driverId);
      expect(resposta.body.permissions).toEqual(
        expect.arrayContaining(['PROFILE_VIEW', 'TRIP_VIEW_OWN']),
      );
      expect(resposta.body.permissions).not.toContain('TRIP_VIEW_ALL');
      expect(resposta.body.password).toBeUndefined();
    });

    it('permissão delegada aparece em /users/me, no login e no refresh; ADMIN tem driverId null', async () => {
      const gerente = await novoUsuario('FLEET_MANAGER');
      await autenticado(tokenAdmin, 'post', `/users/${gerente.id}/permissions`)
        .send({ permissionCode: 'USER_VIEW' })
        .expect(200);

      const me = await autenticado(gerente.token, 'get', '/users/me').expect(200);
      expect(me.body.permissions).toContain('USER_VIEW');
      expect(me.body.driverId).toBeNull();

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-api-key', gerente.apiKey)
        .send({ email: gerente.email, password: 'SenhaForte123' })
        .expect(200);
      expect(login.body.user.permissions).toContain('USER_VIEW');
      expect(login.body.user.driverId).toBeNull();

      const refresh = await autenticado(login.body.accessToken, 'post', '/auth/refresh-token').expect(
        200,
      );
      expect(refresh.body.user.permissions).toContain('USER_VIEW');
      expect(refresh.body.user.driverId).toBeNull();
    });

    it('login e refresh do DRIVER devolvem driverId', async () => {
      const motorista = await novoUsuario('DRIVER');
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-api-key', motorista.apiKey)
        .send({ email: motorista.email, password: 'SenhaForte123' })
        .expect(200);
      expect(login.body.user.driverId).toEqual(motorista.driverId);
      expect(login.body.user.permissions).toContain('TRIP_CREATE');

      const refresh = await autenticado(login.body.accessToken, 'post', '/auth/refresh-token').expect(
        200,
      );
      expect(refresh.body.user.driverId).toEqual(motorista.driverId);
    });
  });
});
