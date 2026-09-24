import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';
import { dataFutura as dataFuturaIso } from './helpers/usuarios-e2e';
import { ViaCepService } from './../src/external/viacep/via-cep.service';
import { garantirPastaDeUploads } from './../src/incidents/utils/upload-incidents.config';

const SENHA = 'SenhaForte123';

jest.setTimeout(60000);

// PNG 1x1 válido (poucos bytes), só para testar upload real de arquivo.
const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Trips, Refuelings e Incidents (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let servicoJwt: JwtService;
  let servicoViaCep: ViaCepService;
  let tokenAdmin: string;
  let roleIdDriver: string;

  const idsDeIncidentParaLimpar: string[] = [];
  const idsDeRefuelingParaLimpar: string[] = [];
  const idsDeTripParaLimpar: string[] = [];
  const idsDeVeiculoParaLimpar: string[] = [];
  const idsDeDriverParaLimpar: string[] = [];
  const idsDeUsuarioParaLimpar: string[] = [];

  function novaPlaca(): string {
    // Formato antigo (3 letras + 4 números), aceito pelo CHECK do banco e pelo validador IsValidPlaca.
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
    // 11 dígitos, formato exigido pelo validador IsValidCnh.
    return randomBytes(6).readUIntBE(0, 6).toString().padStart(11, '0').slice(-11);
  }

  function novoEmail(): string {
    return `e2e-trip-${randomBytes(6).toString('hex')}@test.local`;
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

  async function criarVeiculo(dados: Record<string, unknown> = {}) {
    const resposta = await autenticado(tokenAdmin, 'post', '/vehicles')
      .send({
        plate: novaPlaca(),
        model: 'Fiat Strada',
        year: 2022,
        currentMileage: 1000,
        ...dados,
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
        fullName: 'Motorista Teste Trip',
        roleId: roleIdDriver,
        driver: { licenseNumber: novaCnh(), licenseExpiry: dataFuturaIso() },
      })
      .expect(201);
    idsDeUsuarioParaLimpar.push(usuario.body.id);

    const driver = { body: { ...usuario.body.driver, userId: usuario.body.id } };
    idsDeDriverParaLimpar.push(driver.body.id);

    return driver.body;
  }

  beforeAll(async () => {
    garantirPastaDeUploads();

    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    await app.init();

    prisma = app.get(PrismaService);
    servicoJwt = app.get(JwtService);
    servicoViaCep = app.get(ViaCepService);

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

  describe('Ciclo completo: trip -> refueling -> end -> incident com foto', () => {
    it('percorre o ciclo inteiro da viagem, incluindo upload real de foto', async () => {
      const veiculo = await criarVeiculo({ currentMileage: 10000 });
      const driver = await criarMotorista();

      // 1. POST /trips (PLANNED)
      const trip = await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: veiculo.id,
          startLocation: '01310-100',
          endLocation: '20040-020',
        })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);
      expect(trip.body.status).toEqual('PLANNED');
      expect(trip.body.startKm).toEqual(10000);

      let veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('IN_USE');

      // 2. PATCH /trips/:id/start (IN_PROGRESS)
      const tripIniciada = await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/start`)
        .send({ currentMileage: 10050 })
        .expect(200);
      expect(tripIniciada.body.status).toEqual('IN_PROGRESS');
      expect(tripIniciada.body.startKm).toEqual(10050);

      // 3. POST /refuelings durante a viagem
      const refueling = await autenticado(tokenAdmin, 'post', '/refuelings')
        .send({
          vehicleId: veiculo.id,
          driverId: driver.id,
          mileage: 10100,
          litersAdded: 40.5,
          costPerLiter: 5.899,
          fuelType: 'GASOLINE',
        })
        .expect(201);
      idsDeRefuelingParaLimpar.push(refueling.body.id);
      expect(Number(refueling.body.totalCost)).toBeCloseTo(238.9, 1);

      // 4. PATCH /trips/:id/end (COMPLETED, veículo volta AVAILABLE)
      const tripFinalizada = await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/end`)
        .send({ endMileage: 10300, endLocation: 'Destino final E2E' })
        .expect(200);
      expect(tripFinalizada.body.status).toEqual('COMPLETED');

      veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('AVAILABLE');

      // 5. POST /incidents com upload real de foto
      const incident = await autenticado(tokenAdmin, 'post', '/incidents')
        .field('vehicleId', veiculo.id)
        .field('driverId', driver.id)
        .field('type', 'ACCIDENT')
        .field('severity', 'LOW')
        .field('description', 'Arranhão no para-choque durante a viagem E2E')
        .attach('photo', PNG_MINIMO, 'foto-teste.png')
        .expect(201);
      idsDeIncidentParaLimpar.push(incident.body.id);
      expect(incident.body.status).toEqual('REPORTED');
      expect(incident.body.photoUrl).toMatch(/^http:\/\/localhost:\d+\/uploads\/incidents\//);
      expect(incident.body.photoKey).toMatch(/\.png$/);

      // Confere que o arquivo existe de verdade em uploads/incidents/
      const nomeDoArquivo = incident.body.photoKey as string;
      const caminhoLocal = join(process.cwd(), 'uploads', 'incidents', nomeDoArquivo);
      const fs = await import('fs');
      expect(fs.existsSync(caminhoLocal)).toBe(true);

      // Confere que o GET na photoUrl devolvida realmente serve a imagem
      const caminhoPublico = new URL(incident.body.photoUrl).pathname;
      const respostaDaFoto = await request(app.getHttpServer()).get(caminhoPublico).expect(200);
      expect(respostaDaFoto.headers['content-type']).toMatch(/image/);

      // Limpeza do arquivo físico de teste (hard delete apaga o arquivo)
      await autenticado(tokenAdmin, 'delete', `/incidents/${incident.body.id}`).expect(204);
      await autenticado(tokenAdmin, 'delete', `/incidents/${incident.body.id}/permanent`).expect(
        204,
      );
      idsDeIncidentParaLimpar.splice(idsDeIncidentParaLimpar.indexOf(incident.body.id), 1);
      expect(fs.existsSync(caminhoLocal)).toBe(false);
    });
  });

  describe('Trips: regras de negócio', () => {
    it('DELETE /trips/:id numa trip PLANNED dá 409', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      const trip = await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: veiculo.id,
          startLocation: '30130-010',
          endLocation: '01310-100',
        })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);

      await autenticado(tokenAdmin, 'delete', `/trips/${trip.body.id}`).expect(409);

      // Limpa cancelando (estado terminal) e removendo de vez.
      await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/cancel`).expect(200);
      await autenticado(tokenAdmin, 'delete', `/trips/${trip.body.id}`).expect(204);
      await autenticado(tokenAdmin, 'delete', `/trips/${trip.body.id}/permanent`).expect(204);
      idsDeTripParaLimpar.splice(idsDeTripParaLimpar.indexOf(trip.body.id), 1);
    });

    it('DELETE /trips/:id numa trip IN_PROGRESS dá 409', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      const trip = await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: veiculo.id,
          startLocation: '20040-020',
          endLocation: '30130-010',
        })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);

      await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/start`)
        .send({ currentMileage: veiculo.currentMileage })
        .expect(200);

      await autenticado(tokenAdmin, 'delete', `/trips/${trip.body.id}`).expect(409);

      await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/cancel`).expect(200);
      await autenticado(tokenAdmin, 'delete', `/trips/${trip.body.id}`).expect(204);
      await autenticado(tokenAdmin, 'delete', `/trips/${trip.body.id}/permanent`).expect(204);
      idsDeTripParaLimpar.splice(idsDeTripParaLimpar.indexOf(trip.body.id), 1);
    });

    it('PATCH /trips/:id/cancel numa trip PLANNED devolve o veículo para AVAILABLE', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      const trip = await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: veiculo.id,
          startLocation: '01310-100',
          endLocation: '30130-010',
        })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);

      let veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('IN_USE');

      const cancelada = await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/cancel`)
        .expect(200);
      expect(cancelada.body.status).toEqual('CANCELLED');

      veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('AVAILABLE');
    });

    it('POST /trips com startKm dá 400 (campo removido)', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();
      await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: veiculo.id,
          startKm: veiculo.currentMileage,
          startLocation: '01310-100',
          endLocation: '20040-020',
        })
        .expect(400);
    });

    it('start com leitura maior atualiza startKm da viagem e a quilometragem do veículo', async () => {
      const veiculo = await criarVeiculo({ currentMileage: 5000 });
      const driver = await criarMotorista();
      const trip = await autenticado(tokenAdmin, 'post', '/trips')
        .send({ driverId: driver.id, vehicleId: veiculo.id, startLocation: '01310-100', endLocation: '20040-020' })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);
      expect(trip.body.startKm).toEqual(5000);

      const iniciada = await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/start`)
        .send({ currentMileage: 5120 })
        .expect(200);
      expect(iniciada.body.startKm).toEqual(5120);
      const veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.currentMileage).toEqual(5120);

      // end com km menor que o startKm é rejeitado
      await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/end`)
        .send({ endMileage: 5000, endLocation: 'Destino' })
        .expect(400);
      await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/cancel`).expect(200);
    });

    it('start com leitura menor que a quilometragem do veículo é rejeitado', async () => {
      const veiculo = await criarVeiculo({ currentMileage: 5000 });
      const driver = await criarMotorista();
      const trip = await autenticado(tokenAdmin, 'post', '/trips')
        .send({ driverId: driver.id, vehicleId: veiculo.id, startLocation: '01310-100', endLocation: '20040-020' })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);

      await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/start`)
        .send({ currentMileage: 4000 })
        .expect(409);
      await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/cancel`).expect(200);
    });

    it('POST /trips com veículo inexistente traduz erro da procedure (404)', async () => {
      const driver = await criarMotorista();
      await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: '00000000-0000-0000-0000-000000000000',
          startLocation: '01310-100',
          endLocation: '20040-020',
        })
        .expect(404);
    });
  });

  describe('Incidents: upload', () => {
    it('upload com arquivo maior que 10MB dá 400', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      const arquivoGrande = Buffer.alloc(11 * 1024 * 1024, 1);

      await autenticado(tokenAdmin, 'post', '/incidents')
        .field('vehicleId', veiculo.id)
        .field('driverId', driver.id)
        .field('type', 'OTHER')
        .field('severity', 'LOW')
        .field('description', 'Teste de arquivo grande demais')
        .attach('photo', arquivoGrande, 'grande.png')
        .expect(400);
    });

    it('upload com tipo não permitido (.exe) dá 400', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      await autenticado(tokenAdmin, 'post', '/incidents')
        .field('vehicleId', veiculo.id)
        .field('driverId', driver.id)
        .field('type', 'OTHER')
        .field('severity', 'LOW')
        .field('description', 'Teste de tipo de arquivo não permitido')
        .attach('photo', Buffer.from('conteudo qualquer'), 'arquivo.exe')
        .expect(400);
    });

    it('POST /incidents sem foto funciona (foto é opcional)', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      const incident = await autenticado(tokenAdmin, 'post', '/incidents')
        .field('vehicleId', veiculo.id)
        .field('driverId', driver.id)
        .field('type', 'MECHANICAL_FAILURE')
        .field('severity', 'MEDIUM')
        .field('description', 'Pane elétrica, sem foto anexada')
        .expect(201);
      idsDeIncidentParaLimpar.push(incident.body.id);
      expect(incident.body.photoUrl).toBeNull();
    });
  });

  describe('Refuelings: sem edição livre', () => {
    it('não existe rota PATCH/PUT genérica para refuelings (404 de rota)', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      const refueling = await autenticado(tokenAdmin, 'post', '/refuelings')
        .send({
          vehicleId: veiculo.id,
          driverId: driver.id,
          mileage: veiculo.currentMileage + 50,
          litersAdded: 20,
          costPerLiter: 5,
          fuelType: 'DIESEL',
        })
        .expect(201);
      idsDeRefuelingParaLimpar.push(refueling.body.id);

      await autenticado(tokenAdmin, 'patch', `/refuelings/${refueling.body.id}`)
        .send({ mileage: 999999 })
        .expect(404);
    });
  });

  // BUG 1 corrigido: motorista com só TRIP_VIEW_OWN/REFUELING_VIEW_OWN/
  // INCIDENT_VIEW_OWN (matriz padrão do seed) só pode ver os próprios
  // registros em GET /trips, /refuelings e /incidents — o driverId da query
  // é ignorado (forçado para o próprio) quando o usuário não tem a versão ALL.
  describe('BUG 1: motorista só vê os próprios registros (OWN de verdade)', () => {
    function logarComoDriver(driver: { userId: string }) {
      return servicoJwt.sign({
        sub: driver.userId,
        email: 'driver-own-test@test.local',
        roleId: roleIdDriver,
      });
    }

    it('GET /trips: driver A não vê a trip do driver B (com ou sem filtro), ADMIN vê as duas', async () => {
      const veiculoA = await criarVeiculo();
      const veiculoB = await criarVeiculo();
      const driverA = await criarMotorista();
      const driverB = await criarMotorista();
      const tokenA = logarComoDriver(driverA);

      const tripA = await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driverA.id,
          vehicleId: veiculoA.id,
          startLocation: '01310-100',
          endLocation: '20040-020',
        })
        .expect(201);
      idsDeTripParaLimpar.push(tripA.body.id);

      const tripB = await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driverB.id,
          vehicleId: veiculoB.id,
          startLocation: '20040-020',
          endLocation: '01310-100',
        })
        .expect(201);
      idsDeTripParaLimpar.push(tripB.body.id);

      const listaSemFiltro = await autenticado(tokenA, 'get', '/trips').expect(200);
      const idsSemFiltro = listaSemFiltro.body.data.map((item: { id: string }) => item.id);
      expect(idsSemFiltro).toContain(tripA.body.id);
      expect(idsSemFiltro).not.toContain(tripB.body.id);

      // driverId da query aponta pro OUTRO motorista: é ignorado, continua só a dele.
      const listaComFiltroAlheio = await autenticado(
        tokenA,
        'get',
        `/trips?driverId=${driverB.id}`,
      ).expect(200);
      const idsComFiltroAlheio = listaComFiltroAlheio.body.data.map(
        (item: { id: string }) => item.id,
      );
      expect(idsComFiltroAlheio).toContain(tripA.body.id);
      expect(idsComFiltroAlheio).not.toContain(tripB.body.id);

      const listaAdmin = await autenticado(tokenAdmin, 'get', '/trips').expect(200);
      const idsAdmin = listaAdmin.body.data.map((item: { id: string }) => item.id);
      expect(idsAdmin).toEqual(
        expect.arrayContaining([tripA.body.id, tripB.body.id]),
      );
    });

    it('GET /refuelings: driver A não vê o abastecimento do driver B, ADMIN vê os dois', async () => {
      const veiculoA = await criarVeiculo();
      const veiculoB = await criarVeiculo();
      const driverA = await criarMotorista();
      const driverB = await criarMotorista();
      const tokenA = logarComoDriver(driverA);

      const refuelingA = await autenticado(tokenAdmin, 'post', '/refuelings')
        .send({
          vehicleId: veiculoA.id,
          driverId: driverA.id,
          mileage: veiculoA.currentMileage + 50,
          litersAdded: 20,
          costPerLiter: 5,
          fuelType: 'DIESEL',
        })
        .expect(201);
      idsDeRefuelingParaLimpar.push(refuelingA.body.id);

      const refuelingB = await autenticado(tokenAdmin, 'post', '/refuelings')
        .send({
          vehicleId: veiculoB.id,
          driverId: driverB.id,
          mileage: veiculoB.currentMileage + 50,
          litersAdded: 25,
          costPerLiter: 5.5,
          fuelType: 'GASOLINE',
        })
        .expect(201);
      idsDeRefuelingParaLimpar.push(refuelingB.body.id);

      const listaA = await autenticado(tokenA, 'get', '/refuelings').expect(200);
      const idsA = listaA.body.data.map((item: { id: string }) => item.id);
      expect(idsA).toContain(refuelingA.body.id);
      expect(idsA).not.toContain(refuelingB.body.id);

      const listaAFiltroAlheio = await autenticado(
        tokenA,
        'get',
        `/refuelings?driverId=${driverB.id}`,
      ).expect(200);
      const idsAFiltroAlheio = listaAFiltroAlheio.body.data.map(
        (item: { id: string }) => item.id,
      );
      expect(idsAFiltroAlheio).not.toContain(refuelingB.body.id);

      const listaAdmin = await autenticado(tokenAdmin, 'get', '/refuelings').expect(200);
      const idsAdmin = listaAdmin.body.data.map((item: { id: string }) => item.id);
      expect(idsAdmin).toEqual(
        expect.arrayContaining([refuelingA.body.id, refuelingB.body.id]),
      );
    });

    it('GET /incidents: driver A não vê o incidente do driver B, ADMIN vê os dois (com filtro driverId)', async () => {
      const veiculoA = await criarVeiculo();
      const veiculoB = await criarVeiculo();
      const driverA = await criarMotorista();
      const driverB = await criarMotorista();
      const tokenA = logarComoDriver(driverA);

      const incidentA = await autenticado(tokenAdmin, 'post', '/incidents')
        .field('vehicleId', veiculoA.id)
        .field('driverId', driverA.id)
        .field('type', 'OTHER')
        .field('severity', 'LOW')
        .field('description', 'Incidente do driver A (teste OWN)')
        .expect(201);
      idsDeIncidentParaLimpar.push(incidentA.body.id);

      const incidentB = await autenticado(tokenAdmin, 'post', '/incidents')
        .field('vehicleId', veiculoB.id)
        .field('driverId', driverB.id)
        .field('type', 'OTHER')
        .field('severity', 'LOW')
        .field('description', 'Incidente do driver B (teste OWN)')
        .expect(201);
      idsDeIncidentParaLimpar.push(incidentB.body.id);

      const listaA = await autenticado(tokenA, 'get', '/incidents').expect(200);
      const idsA = listaA.body.data.map((item: { id: string }) => item.id);
      expect(idsA).toContain(incidentA.body.id);
      expect(idsA).not.toContain(incidentB.body.id);

      // ADMIN com filtro driverId=driverB só traz o incidente do B (novo filtro do BUG 1).
      const listaAdminFiltrada = await autenticado(
        tokenAdmin,
        'get',
        `/incidents?driverId=${driverB.id}`,
      ).expect(200);
      const idsAdminFiltrada = listaAdminFiltrada.body.data.map(
        (item: { id: string }) => item.id,
      );
      expect(idsAdminFiltrada).toContain(incidentB.body.id);
      expect(idsAdminFiltrada).not.toContain(incidentA.body.id);
    });

    it('driver com papel DRIVER mas sem Driver vinculado recebe lista vazia (não erro)', async () => {
      // A API não cria mais DRIVER sem perfil; o banco direto simula um caso legado.
      const usuarioSemDriver = await prisma.user.create({
        data: {
          email: novoEmail(),
          password: 'hash-de-teste-nao-usado-para-login',
          fullName: 'Usuario Sem Driver Vinculado',
          roleId: roleIdDriver,
        },
      });
      idsDeUsuarioParaLimpar.push(usuarioSemDriver.id);
      const token = servicoJwt.sign({
        sub: usuarioSemDriver.id,
        email: usuarioSemDriver.email,
        roleId: roleIdDriver,
      });

      const resposta = await autenticado(token, 'get', '/trips').expect(200);
      expect(resposta.body.data).toEqual([]);
      expect(resposta.body.pagination.total).toEqual(0);
    });
  });

  // Chamada real à API do ViaCEP (viacep.com.br), sem mock — é o requisito
  // crítico do Passo 27 (usar HttpService de verdade pra consumir API externa).
  describe('ViaCEP: integração real (sem mock)', () => {
    it('ViaCepService.buscarPorCep resolve um CEP válido de verdade', async () => {
      const endereco = await servicoViaCep.buscarPorCep('01310-100');
      expect(endereco.localidade).toEqual('São Paulo');
      expect(endereco.uf).toEqual('SP');
      expect(endereco.fullAddress).toEqual('São Paulo, SP');
    });

    it('CEP com máscara e sem máscara devolvem o mesmo resultado', async () => {
      const comMascara = await servicoViaCep.buscarPorCep('20040-020');
      const semMascara = await servicoViaCep.buscarPorCep('20040020');
      expect(comMascara.localidade).toEqual(semMascara.localidade);
      expect(comMascara.uf).toEqual(semMascara.uf);
    });

    it('CEP inexistente lança BadRequestException (400)', async () => {
      await expect(servicoViaCep.buscarPorCep('00000-000')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('CEP mal formatado falha rápido (400), sem nem chamar a API', async () => {
      const inicio = Date.now();
      await expect(servicoViaCep.buscarPorCep('ABC-DEFG')).rejects.toMatchObject({
        status: 400,
      });
      await expect(servicoViaCep.buscarPorCep('123')).rejects.toMatchObject({
        status: 400,
      });
      // Bem abaixo do timeout configurado (10s): confirma que não foi à rede.
      expect(Date.now() - inicio).toBeLessThan(2000);
    });

    it('POST /trips com CEPs válidos grava o endereço resolvido, não o CEP cru', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      const trip = await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: veiculo.id,
          startLocation: '01310-100',
          endLocation: '30130-010',
        })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);

      expect(trip.body.startLocation).toEqual('São Paulo, SP');
      expect(trip.body.endLocation).toEqual('Belo Horizonte, MG');

      const viagemNoBanco = await prisma.trip.findUnique({ where: { id: trip.body.id } });
      expect(viagemNoBanco?.startLocation).toEqual('São Paulo, SP');
      expect(viagemNoBanco?.endLocation).toEqual('Belo Horizonte, MG');
    });

    it('POST /trips com CEP inválido em startLocation dá 400', async () => {
      const veiculo = await criarVeiculo();
      const driver = await criarMotorista();

      await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: veiculo.id,
          startLocation: '00000-000',
          endLocation: '20040-020',
        })
        .expect(400);
    });
  });
});
