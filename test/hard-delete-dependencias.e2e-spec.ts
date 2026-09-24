import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';

jest.setTimeout(60000);

// Deleção total (/permanent) com dependências: 409 claro ou apagar junto (incidentes resolvidos).
describe('Hard delete com dependências (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  let roleIdDriver: string;

  const idsDeIncidente: string[] = [];
  const idsDeViagem: string[] = [];
  const idsDeMotorista: string[] = [];
  const idsDeVeiculo: string[] = [];
  const idsDeUsuario: string[] = [];

  function novaPlaca(): string {
    const letras = Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26)),
    ).join('');
    const numeros = randomBytes(2).readUInt16BE(0).toString().padStart(4, '0').slice(-4);
    return `${letras}${numeros}`;
  }

  function novaCnh(): string {
    return randomBytes(6).readUIntBE(0, 6).toString().padStart(11, '0').slice(-11);
  }

  function apagarComoAdmin(caminho: string) {
    return request(app.getHttpServer())
      .delete(caminho)
      .set('Authorization', `Bearer ${tokenAdmin}`);
  }

  async function criarUsuario() {
    const usuario = await prisma.user.create({
      data: {
        email: `e2e-hdd-${randomBytes(6).toString('hex')}@test.local`,
        password: 'hash-de-teste-nao-usado-para-login',
        fullName: 'Usuario Teste Dependencias',
        roleId: roleIdDriver,
      },
    });
    idsDeUsuario.push(usuario.id);
    return usuario;
  }

  async function criarMotorista(idDoUsuario: string) {
    const validade = new Date();
    validade.setFullYear(validade.getFullYear() + 1);
    const motorista = await prisma.driver.create({
      data: { userId: idDoUsuario, licenseNumber: novaCnh(), licenseExpiry: validade },
    });
    idsDeMotorista.push(motorista.id);
    return motorista;
  }

  async function criarVeiculo() {
    const veiculo = await prisma.vehicle.create({
      data: {
        plate: novaPlaca(),
        model: 'Fiat Strada',
        year: 2022,
        currentMileage: 1000,
        lastMaintenanceKm: 0,
      },
    });
    idsDeVeiculo.push(veiculo.id);
    return veiculo;
  }

  async function criarViagem(idMotorista: string, idVeiculo: string, idCriador: string) {
    const viagem = await prisma.trip.create({
      data: {
        driverId: idMotorista,
        vehicleId: idVeiculo,
        status: 'PLANNED',
        startKm: 1000,
        startLocation: 'São Paulo, SP',
        endLocation: 'Belo Horizonte, MG',
        createdBy: idCriador,
      },
    });
    idsDeViagem.push(viagem.id);
    return viagem;
  }

  async function criarIncidente(
    viagem: { id: string; driverId: string; vehicleId: string },
    idCriador: string,
    status: 'REPORTED' | 'RESOLVED',
  ) {
    const incidente = await prisma.incident.create({
      data: {
        tripId: viagem.id,
        vehicleId: viagem.vehicleId,
        driverId: viagem.driverId,
        type: 'OTHER',
        status,
        description: 'Incidente de teste',
        registeredBy: idCriador,
      },
    });
    idsDeIncidente.push(incidente.id);
    return incidente;
  }

  // Cenário padrão: um usuário, seu motorista, um veículo e uma viagem.
  async function criarCenarioDeViagem() {
    const usuario = await criarUsuario();
    const motorista = await criarMotorista(usuario.id);
    const veiculo = await criarVeiculo();
    const viagem = await criarViagem(motorista.id, veiculo.id, usuario.id);
    return { usuario, motorista, veiculo, viagem };
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

    const papelDriver = await prisma.role.findUnique({ where: { name: 'DRIVER' } });
    if (!papelDriver) {
      throw new Error('Papel DRIVER não encontrado. O seed foi executado?');
    }
    roleIdDriver = papelDriver.id;
  });

  afterAll(async () => {
    // Dependentes primeiro. audit_logs gerados ficam (append-only), com autor NULL.
    if (prisma) {
      await prisma.incident.deleteMany({ where: { id: { in: idsDeIncidente } } });
      await prisma.trip.deleteMany({ where: { id: { in: idsDeViagem } } });
      await prisma.driver.deleteMany({ where: { id: { in: idsDeMotorista } } });
      await prisma.vehicle.deleteMany({ where: { id: { in: idsDeVeiculo } } });
      await prisma.user.deleteMany({ where: { id: { in: idsDeUsuario } } });
    }
    if (app) {
      await app.close();
    }
  });

  it('usuário com histórico de auditoria é apagado de vez (204) e o audit fica com autor NULL', async () => {
    const cenario = await criarCenarioDeViagem();
    const autor = await criarUsuario();

    // Gera uma linha de audit_logs cujo autor é "autor" (sem ele registrar nada).
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${autor.id}::text, true)`;
      await tx.trip.update({
        where: { id: cenario.viagem.id },
        data: { startLocation: 'Campinas, SP' },
      });
    });
    const logAntes = await prisma.auditLog.findFirst({ where: { changedBy: autor.id } });
    expect(logAntes).not.toBeNull();

    await apagarComoAdmin(`/users/${autor.id}/permanent`).expect(204);

    const usuarioNoBanco = await prisma.user.findUnique({ where: { id: autor.id } });
    expect(usuarioNoBanco).toBeNull();
    const logDepois = await prisma.auditLog.findUnique({ where: { id: logAntes!.id } });
    expect(logDepois).not.toBeNull();
    expect(logDepois!.changedBy).toBeNull();
  });

  it('motorista com viagem: 409 com mensagem clara', async () => {
    const cenario = await criarCenarioDeViagem();

    const resposta = await apagarComoAdmin(`/drivers/${cenario.motorista.id}/permanent`).expect(409);
    expect(resposta.body.detail).toContain('associated trips');
    const noBanco = await prisma.driver.findUnique({ where: { id: cenario.motorista.id } });
    expect(noBanco).not.toBeNull();
  });

  it('veículo com viagem: 409', async () => {
    const cenario = await criarCenarioDeViagem();

    const resposta = await apagarComoAdmin(`/vehicles/${cenario.veiculo.id}/permanent`).expect(409);
    expect(resposta.body.detail).toContain('associated trips');
  });

  it('viagem com incidente não resolvido: 409 e nada é apagado', async () => {
    const cenario = await criarCenarioDeViagem();
    const incidenteAberto = await criarIncidente(cenario.viagem, cenario.usuario.id, 'REPORTED');
    const incidenteResolvido = await criarIncidente(cenario.viagem, cenario.usuario.id, 'RESOLVED');

    const resposta = await apagarComoAdmin(`/trips/${cenario.viagem.id}/permanent`).expect(409);
    expect(resposta.body.detail).toContain('unresolved incidents');

    const viagemNoBanco = await prisma.trip.findUnique({ where: { id: cenario.viagem.id } });
    expect(viagemNoBanco).not.toBeNull();
    const incidentesNoBanco = await prisma.incident.count({
      where: { id: { in: [incidenteAberto.id, incidenteResolvido.id] } },
    });
    expect(incidentesNoBanco).toBe(2);
  });

  it('viagem com incidentes todos RESOLVED: 204 e os incidentes somem junto (sem órfãos)', async () => {
    const cenario = await criarCenarioDeViagem();
    const primeiro = await criarIncidente(cenario.viagem, cenario.usuario.id, 'RESOLVED');
    const segundo = await criarIncidente(cenario.viagem, cenario.usuario.id, 'RESOLVED');

    await apagarComoAdmin(`/trips/${cenario.viagem.id}/permanent`).expect(204);

    const viagemNoBanco = await prisma.trip.findUnique({ where: { id: cenario.viagem.id } });
    expect(viagemNoBanco).toBeNull();
    const incidentesRestantes = await prisma.incident.count({
      where: { id: { in: [primeiro.id, segundo.id] } },
    });
    expect(incidentesRestantes).toBe(0);
    const orfaos = await prisma.incident.count({
      where: { id: { in: [primeiro.id, segundo.id] }, tripId: null },
    });
    expect(orfaos).toBe(0);
  });

  it('viagem sem incidentes: 204', async () => {
    const cenario = await criarCenarioDeViagem();

    await apagarComoAdmin(`/trips/${cenario.viagem.id}/permanent`).expect(204);

    const viagemNoBanco = await prisma.trip.findUnique({ where: { id: cenario.viagem.id } });
    expect(viagemNoBanco).toBeNull();
  });
});
