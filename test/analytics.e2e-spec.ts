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
import { dataFutura as dataFuturaIso } from './helpers/usuarios-e2e';

const SENHA = 'SenhaForte123';

jest.setTimeout(60000);

describe('Analytics (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicoJwt: JwtService;
  let tokenAdmin: string;
  let tokenDriver: string;
  let roleIdDriver: string;

  const idsDeIncidentParaLimpar: string[] = [];
  const idsDeRefuelingParaLimpar: string[] = [];
  const idsDeTripParaLimpar: string[] = [];
  const idsDeVeiculoParaLimpar: string[] = [];
  const idsDeDriverParaLimpar: string[] = [];
  const idsDeUsuarioParaLimpar: string[] = [];

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

  function novoEmail(): string {
    return `e2e-analytics-${randomBytes(6).toString('hex')}@test.local`;
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

  async function criarVeiculo(mileageInicial: number) {
    const resposta = await autenticado(tokenAdmin, 'post', '/vehicles')
      .send({
        plate: novaPlaca(),
        model: 'Fiat Strada',
        year: 2022,
        currentMileage: mileageInicial,
      })
      .expect(201);
    idsDeVeiculoParaLimpar.push(resposta.body.id);
    return resposta.body;
  }

  async function criarMotorista() {
    const usuario = await autenticado(tokenAdmin, 'post', '/users')
      .send({
        email: novoEmail(),
        password: SENHA,
        fullName: 'Motorista Teste Analytics',
        roleId: roleIdDriver,
        driver: { licenseNumber: novaCnh(), licenseExpiry: dataFuturaIso() },
      })
      .expect(201);
    idsDeUsuarioParaLimpar.push(usuario.body.id);

    const driver = { body: { ...usuario.body.driver, userId: usuario.body.id } };
    idsDeDriverParaLimpar.push(driver.body.id);

    return driver.body;
  }

  // Cria uma trip e a leva até COMPLETED (start -> end), com km conhecido.
  async function criarViagemConcluida(
    driverId: string,
    vehicleId: string,
    startKm: number,
    endKm: number,
  ) {
    const trip = await autenticado(tokenAdmin, 'post', '/trips')
      .send({
        driverId,
        vehicleId,
        startLocation: '01310-100',
        endLocation: '20040-020',
      })
      .expect(201);
    idsDeTripParaLimpar.push(trip.body.id);

    await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/start`)
      .send({ currentMileage: startKm })
      .expect(200);

    const finalizada = await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/end`)
      .send({ endMileage: endKm, endLocation: 'Destino teste analytics' })
      .expect(200);

    return finalizada.body;
  }

  async function criarAbastecimento(
    driverId: string,
    vehicleId: string,
    mileage: number,
    litersAdded: number,
    costPerLiter: number,
  ) {
    const resposta = await autenticado(tokenAdmin, 'post', '/refuelings')
      .send({ vehicleId, driverId, mileage, litersAdded, costPerLiter, fuelType: 'DIESEL' })
      .expect(201);
    idsDeRefuelingParaLimpar.push(resposta.body.id);
    return resposta.body;
  }

  async function criarIncidente(driverId: string, vehicleId: string, severity: string) {
    const resposta = await autenticado(tokenAdmin, 'post', '/incidents')
      .field('vehicleId', vehicleId)
      .field('driverId', driverId)
      .field('type', 'OTHER')
      .field('severity', severity)
      .field('description', 'Incidente de teste do módulo de analytics')
      .expect(201);
    idsDeIncidentParaLimpar.push(resposta.body.id);
    return resposta.body;
  }

  beforeAll(async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication<INestApplication<App>>();
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
    if (!papelDriver) {
      throw new Error('Papel DRIVER não encontrado. O seed foi executado?');
    }
    roleIdDriver = papelDriver.id;

    const usuarioDriver = await autenticado(tokenAdmin, 'post', '/users')
      .send({
        email: novoEmail(),
        password: SENHA,
        fullName: 'Motorista RBAC Analytics',
        roleId: roleIdDriver,
        driver: { licenseNumber: novaCnh(), licenseExpiry: dataFuturaIso() },
      })
      .expect(201);
    idsDeUsuarioParaLimpar.push(usuarioDriver.body.id);
    tokenDriver = servicoJwt.sign({
      sub: usuarioDriver.body.id,
      email: usuarioDriver.body.email,
      roleId: roleIdDriver,
    });
  });

  afterAll(async () => {
    if (prisma) {
      if (idsDeIncidentParaLimpar.length > 0) {
        for (const id of idsDeIncidentParaLimpar) {
          await autenticado(tokenAdmin, 'delete', `/incidents/${id}`).catch(() => undefined);
          await autenticado(tokenAdmin, 'delete', `/incidents/${id}/permanent`).catch(
            () => undefined,
          );
        }
      }
      if (idsDeRefuelingParaLimpar.length > 0) {
        await prisma.refueling.deleteMany({ where: { id: { in: idsDeRefuelingParaLimpar } } });
      }
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

  describe('RBAC: DRIVER não acessa nenhuma rota de analytics', () => {
    it.each([
      ['/analytics/fleet/fuel-consumption'],
      ['/analytics/fleet/daily-distance'],
      ['/analytics/incidents/severity'],
    ])('GET %s com token de DRIVER dá 403', async (caminho) => {
      await autenticado(tokenDriver, 'get', caminho).expect(403);
    });

    it('GET /analytics/vehicle/:id/efficiency com token de DRIVER dá 403', async () => {
      await autenticado(
        tokenDriver,
        'get',
        '/analytics/vehicle/00000000-0000-0000-0000-000000000000/efficiency',
      ).expect(403);
    });

    it('GET /analytics/driver/:id/trips com token de DRIVER dá 403', async () => {
      await autenticado(
        tokenDriver,
        'get',
        '/analytics/driver/00000000-0000-0000-0000-000000000000/trips',
      ).expect(403);
    });
  });

  describe('Cenário de dados reais: veículo, motorista, trips, abastecimento, incidente', () => {
    it('confere os 5 indicadores batendo com os dados inseridos', async () => {
      const veiculo = await criarVeiculo(5000);
      const driver = await criarMotorista();

      // 2 viagens concluídas: 100km + 150km = 250km no total.
      await criarViagemConcluida(driver.id, veiculo.id, 5000, 5100);
      await criarViagemConcluida(driver.id, veiculo.id, 5100, 5250);

      // 1 abastecimento: 25 litros a 5 reais/litro = 125 reais.
      await criarAbastecimento(driver.id, veiculo.id, 5250, 25, 5);

      // 1 incidente LOW.
      await criarIncidente(driver.id, veiculo.id, 'LOW');

      // 1. Frota: outras suites rodam em paralelo no mesmo banco e criam/apagam dados,
      // então diff antes/depois é instável. Usamos só limites mínimos (nossos dados
      // já estão lá) e a coerência litros/km. Os valores exatos ficam nos itens 3 e 4.
      const consumo = await autenticado(
        tokenAdmin,
        'get',
        '/analytics/fleet/fuel-consumption',
      ).expect(200);
      expect(consumo.body.totalLiters).toBeGreaterThanOrEqual(25 - 1e-6);
      expect(consumo.body.totalKm).toBeGreaterThanOrEqual(250);
      expect(consumo.body.averageLitersPerKm).toBeCloseTo(
        consumo.body.totalLiters / consumo.body.totalKm,
        5,
      );

      // 2. Distância diária: a linha de hoje tem pelo menos os 250km das nossas viagens.
      const distancia = await autenticado(
        tokenAdmin,
        'get',
        '/analytics/fleet/daily-distance',
      ).expect(200);
      const hoje = new Date().toISOString().slice(0, 10);
      const linhaDeHoje = distancia.body.find((linha: { date: string }) => linha.date === hoje);
      expect(linhaDeHoje).toBeDefined();
      expect(linhaDeHoje.totalKm).toBeGreaterThanOrEqual(250);

      // 3. GET /analytics/vehicle/:id/efficiency: escopado ao veículo, número exato.
      const eficiencia = await autenticado(
        tokenAdmin,
        'get',
        `/analytics/vehicle/${veiculo.id}/efficiency`,
      ).expect(200);
      expect(eficiencia.body.totalKm).toEqual(250);
      expect(eficiencia.body.totalLiters).toBeCloseTo(25, 5);
      expect(eficiencia.body.totalFuelCost).toBeCloseTo(125, 5);
      expect(eficiencia.body.averageLitersPerKm).toBeCloseTo(25 / 250, 5);
      expect(eficiencia.body.tripsCount).toEqual(2);
      expect(eficiencia.body.incidentsCount).toEqual(1);

      // 4. GET /analytics/driver/:id/trips: escopado ao motorista, número exato.
      const estatisticasDoMotorista = await autenticado(
        tokenAdmin,
        'get',
        `/analytics/driver/${driver.id}/trips`,
      ).expect(200);
      expect(estatisticasDoMotorista.body.tripsByStatus).toEqual({
        PLANNED: 0,
        IN_PROGRESS: 0,
        COMPLETED: 2,
        CANCELLED: 0,
      });
      expect(estatisticasDoMotorista.body.totalKmCompleted).toEqual(250);
      expect(estatisticasDoMotorista.body.incidentsCount).toEqual(1);

      // 5. Severidade global: LOW tem pelo menos o incidente que criamos.
      const incidentes = await autenticado(
        tokenAdmin,
        'get',
        '/analytics/incidents/severity',
      ).expect(200);
      const linhaLow = incidentes.body.find(
        (linha: { severity: string }) => linha.severity === 'LOW',
      );
      expect(linhaLow).toBeDefined();
      expect(linhaLow.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Veículo/motorista sem nenhuma viagem: 200 com zeros, não 404', () => {
    it('GET /analytics/vehicle/:id/efficiency de um veículo novo devolve zeros', async () => {
      const veiculo = await criarVeiculo(1000);

      const resposta = await autenticado(
        tokenAdmin,
        'get',
        `/analytics/vehicle/${veiculo.id}/efficiency`,
      ).expect(200);

      expect(resposta.body.totalKm).toEqual(0);
      expect(resposta.body.totalLiters).toEqual(0);
      expect(resposta.body.totalFuelCost).toEqual(0);
      expect(resposta.body.averageLitersPerKm).toEqual(0);
      expect(resposta.body.tripsCount).toEqual(0);
      expect(resposta.body.incidentsCount).toEqual(0);
    });

    it('GET /analytics/driver/:id/trips de um motorista novo devolve zeros', async () => {
      const driver = await criarMotorista();

      const resposta = await autenticado(
        tokenAdmin,
        'get',
        `/analytics/driver/${driver.id}/trips`,
      ).expect(200);

      expect(resposta.body.tripsByStatus).toEqual({
        PLANNED: 0,
        IN_PROGRESS: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      });
      expect(resposta.body.totalKmCompleted).toEqual(0);
      expect(resposta.body.incidentsCount).toEqual(0);
    });
  });

  describe('UUID inexistente: 404', () => {
    it('GET /analytics/vehicle/:id/efficiency com UUID inexistente dá 404', async () => {
      await autenticado(
        tokenAdmin,
        'get',
        '/analytics/vehicle/00000000-0000-0000-0000-000000000000/efficiency',
      ).expect(404);
    });

    it('GET /analytics/driver/:id/trips com UUID inexistente dá 404', async () => {
      await autenticado(
        tokenAdmin,
        'get',
        '/analytics/driver/00000000-0000-0000-0000-000000000000/trips',
      ).expect(404);
    });

    it('GET /analytics/vehicle/:id/efficiency com id fora do formato UUID dá 400', async () => {
      await autenticado(tokenAdmin, 'get', '/analytics/vehicle/nao-e-um-uuid/efficiency').expect(
        400,
      );
    });
  });

  describe('GET /analytics/fleet/daily-distance: parâmetro days', () => {
    it('days fora do intervalo aceito (0 ou 400) dá 400', async () => {
      await autenticado(tokenAdmin, 'get', '/analytics/fleet/daily-distance?days=0').expect(400);
      await autenticado(tokenAdmin, 'get', '/analytics/fleet/daily-distance?days=400').expect(
        400,
      );
    });

    it('sem days usa o padrão de 30 e devolve 200', async () => {
      const resposta = await autenticado(
        tokenAdmin,
        'get',
        '/analytics/fleet/daily-distance',
      ).expect(200);
      expect(Array.isArray(resposta.body)).toBe(true);
    });
  });
});
