import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';
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
  let tokenAdmin: string;
  let roleIdDriver: string;

  const idsDeIncidentParaLimpar: string[] = [];
  const idsDeRefuelingParaLimpar: string[] = [];
  const idsDeTripParaLimpar: string[] = [];
  const idsDeVeiculoParaLimpar: string[] = [];
  const idsDeDriverParaLimpar: string[] = [];
  const idsDeUsuarioParaLimpar: string[] = [];

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
          startKm: 10000,
          startLocation: 'Origem E2E',
          endLocation: 'Destino E2E',
        })
        .expect(201);
      idsDeTripParaLimpar.push(trip.body.id);
      expect(trip.body.status).toEqual('PLANNED');

      let veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('IN_USE');

      // 2. PATCH /trips/:id/start (IN_PROGRESS)
      const tripIniciada = await autenticado(tokenAdmin, 'patch', `/trips/${trip.body.id}/start`)
        .send({ currentMileage: 10050 })
        .expect(200);
      expect(tripIniciada.body.status).toEqual('IN_PROGRESS');

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
          startKm: veiculo.currentMileage,
          startLocation: 'Origem',
          endLocation: 'Destino',
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
          startKm: veiculo.currentMileage,
          startLocation: 'Origem',
          endLocation: 'Destino',
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
          startKm: veiculo.currentMileage,
          startLocation: 'Origem',
          endLocation: 'Destino',
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

    it('POST /trips com veículo inexistente traduz erro da procedure (404)', async () => {
      const driver = await criarMotorista();
      await autenticado(tokenAdmin, 'post', '/trips')
        .send({
          driverId: driver.id,
          vehicleId: '00000000-0000-0000-0000-000000000000',
          startKm: 0,
          startLocation: 'Origem',
          endLocation: 'Destino',
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
});
