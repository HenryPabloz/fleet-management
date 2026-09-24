import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';
import { dataFutura, novaCnh } from './helpers/usuarios-e2e';

const SENHA = 'SenhaForte123';

jest.setTimeout(120000);

interface Recurso {
  nome: string;
  rota: string;
  prefixo: string;
  gerentePode: boolean;
  id: string;
}

describe('Permissions de soft delete/restore e isActive (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  let idAdmin: string;
  let roleIdFleetManager: string;
  let roleIdDriver: string;
  let gerente: { id: string; token: string };
  let recursos: Recurso[] = [];

  const idsUsuarios: string[] = [];
  const idsMotoristas: string[] = [];
  const idsVeiculos: string[] = [];
  const idsViagens: string[] = [];
  const idsAbastecimentos: string[] = [];
  const idsManutencoes: string[] = [];
  const idsIncidentes: string[] = [];

  function sufixo(): string {
    return randomBytes(4).toString('hex');
  }

  function autenticado(
    metodo: 'get' | 'post' | 'patch' | 'delete',
    caminho: string,
    token: string,
  ) {
    return request(app.getHttpServer())
      [metodo](caminho)
      .set('Authorization', `Bearer ${token}`);
  }

  async function criarUsuarioELogar(roleId: string, nome: string) {
    const email = `e2e-sdp-${sufixo()}@test.local`;
    const corpo: Record<string, unknown> = { email, password: SENHA, fullName: nome, roleId };
    if (roleId === roleIdDriver) {
      corpo.driver = { licenseNumber: novaCnh(), licenseExpiry: dataFutura() };
    }
    const cadastro = await autenticado('post', '/users', tokenAdmin).send(corpo).expect(201);
    const id = cadastro.body.id as string;
    idsUsuarios.push(id);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', cadastro.body.apiKey as string)
      .send({ email, password: SENHA })
      .expect(200);
    return { id, token: login.body.accessToken as string };
  }

  async function criarUsuarioSimples(): Promise<string> {
    const usuario = await prisma.user.create({
      data: {
        email: `e2e-sdp-${sufixo()}@test.local`,
        password: 'hash-de-teste',
        fullName: 'Alvo SDP',
        roleId: roleIdDriver,
      },
    });
    idsUsuarios.push(usuario.id);
    return usuario.id;
  }

  async function criarVeiculo(): Promise<string> {
    const veiculo = await prisma.vehicle.create({
      data: {
        plate: `Z${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 9000 + 1000)}`,
        model: 'Modelo SDP',
        year: 2020,
        currentMileage: 1000,
        lastMaintenanceKm: 0,
      },
    });
    idsVeiculos.push(veiculo.id);
    return veiculo.id;
  }

  async function criarMotorista(): Promise<string> {
    const idUsuario = await criarUsuarioSimples();
    const motorista = await prisma.driver.create({
      data: {
        userId: idUsuario,
        licenseNumber: `9${Math.floor(Math.random() * 10000000000).toString().padStart(10, "0")}`,
        licenseExpiry: new Date('2035-01-01'),
      },
    });
    idsMotoristas.push(motorista.id);
    return motorista.id;
  }

  async function montarRecursos(): Promise<Recurso[]> {
    const idVeiculo = await criarVeiculo();
    const idMotorista = await criarMotorista();

    const viagem = await prisma.trip.create({
      data: {
        driverId: idMotorista,
        vehicleId: idVeiculo,
        status: 'CANCELLED',
        startKm: 1000,
        startLocation: 'A',
        endLocation: 'B',
        createdBy: idAdmin,
      },
    });
    idsViagens.push(viagem.id);

    const abastecimento = await prisma.refueling.create({
      data: {
        vehicleId: idVeiculo,
        driverId: idMotorista,
        mileage: 1000,
        litersAdded: 10,
        costPerLiter: 5,
        totalCost: 50,
        fuelType: 'DIESEL',
        registeredBy: idAdmin,
      },
    });
    idsAbastecimentos.push(abastecimento.id);

    const manutencao = await prisma.maintenance.create({
      data: {
        vehicleId: idVeiculo,
        type: 'PREVENTIVE',
        status: 'COMPLETED',
        scheduledDate: new Date(),
        completedDate: new Date(),
        description: 'Manutencao SDP',
        cost: 100,
        registeredBy: idAdmin,
      },
    });
    idsManutencoes.push(manutencao.id);

    const incidente = await prisma.incident.create({
      data: {
        vehicleId: idVeiculo,
        driverId: idMotorista,
        type: 'OTHER',
        description: 'Incidente SDP',
        registeredBy: idAdmin,
      },
    });
    idsIncidentes.push(incidente.id);

    const idUsuarioAlvo = await criarUsuarioSimples();
    const idMotoristaAlvo = await criarMotorista();
    const idVeiculoAlvo = await criarVeiculo();

    return [
      { nome: 'users', rota: '/users', prefixo: 'USER', gerentePode: false, id: idUsuarioAlvo },
      { nome: 'drivers', rota: '/drivers', prefixo: 'DRIVER', gerentePode: false, id: idMotoristaAlvo },
      { nome: 'vehicles', rota: '/vehicles', prefixo: 'VEHICLE', gerentePode: true, id: idVeiculoAlvo },
      { nome: 'trips', rota: '/trips', prefixo: 'TRIP', gerentePode: false, id: viagem.id },
      { nome: 'refuelings', rota: '/refuelings', prefixo: 'REFUELING', gerentePode: false, id: abastecimento.id },
      { nome: 'maintenances', rota: '/maintenances', prefixo: 'MAINTENANCE', gerentePode: true, id: manutencao.id },
      { nome: 'incidents', rota: '/incidents', prefixo: 'INCIDENT', gerentePode: true, id: incidente.id },
    ];
  }

  async function conceder(idUsuario: string, codigo: string) {
    await autenticado('post', `/users/${idUsuario}/permissions`, tokenAdmin)
      .send({ permissionCode: codigo })
      .expect(200);
  }

  async function revogar(idUsuario: string, codigo: string) {
    await autenticado('delete', `/users/${idUsuario}/permissions/${codigo}`, tokenAdmin).expect(204);
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

    const admin = await prisma.user.findUnique({
      where: { email: (process.env.ADMIN_EMAIL as string).toLowerCase() },
    });
    idAdmin = (admin as { id: string }).id;

    const papelFleetManager = await prisma.role.findUnique({ where: { name: 'FLEET_MANAGER' } });
    const papelDriver = await prisma.role.findUnique({ where: { name: 'DRIVER' } });
    roleIdFleetManager = (papelFleetManager as { id: string }).id;
    roleIdDriver = (papelDriver as { id: string }).id;

    gerente = await criarUsuarioELogar(roleIdFleetManager, 'Gerente SDP');
    recursos = await montarRecursos();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.incident.deleteMany({ where: { id: { in: idsIncidentes } } });
      await prisma.refueling.deleteMany({ where: { id: { in: idsAbastecimentos } } });
      await prisma.trip.deleteMany({ where: { id: { in: idsViagens } } });
      await prisma.maintenance.deleteMany({ where: { id: { in: idsManutencoes } } });
      await prisma.driver.deleteMany({ where: { id: { in: idsMotoristas } } });
      await prisma.vehicle.deleteMany({ where: { id: { in: idsVeiculos } } });
      await prisma.userPermission.deleteMany({ where: { userId: { in: idsUsuarios } } });
      await prisma.user.deleteMany({ where: { id: { in: idsUsuarios } } });
    }
    if (app) {
      await app.close();
    }
  });

  it('catálogo tem 44 permissions e as 13 do soft delete existem', async () => {
    const total = await prisma.permission.count();
    expect(total).toBe(44);
    const resposta = await autenticado('get', '/permissions', tokenAdmin).expect(200);
    const codigos = resposta.body.map((item: { code: string }) => item.code);
    const novas = [
      'USER_RESTORE', 'DRIVER_DELETE', 'DRIVER_RESTORE', 'VEHICLE_DELETE', 'VEHICLE_RESTORE',
      'TRIP_DELETE', 'TRIP_RESTORE', 'REFUELING_DELETE', 'REFUELING_RESTORE',
      'MAINTENANCE_DELETE', 'MAINTENANCE_RESTORE', 'INCIDENT_DELETE', 'INCIDENT_RESTORE',
    ];
    expect(codigos).toEqual(expect.arrayContaining(novas));
    expect(codigos.length).toBe(44);
  });

  const nomesRecursos = ['users', 'drivers', 'vehicles', 'trips', 'refuelings', 'maintenances', 'incidents'];

  for (const nomeRecurso of nomesRecursos) {
    describe(`Recurso ${nomeRecurso}`, () => {
      function recurso(): Recurso {
        return recursos.find((item) => item.nome === nomeRecurso) as Recurso;
      }

      it('ADMIN faz soft delete (204), deleted/all (200) e restore (200)', async () => {
        const r = recurso();
        await autenticado('delete', `${r.rota}/${r.id}`, tokenAdmin).expect(204);
        await autenticado('get', `${r.rota}/deleted/all`, tokenAdmin).expect(200);
        await autenticado('patch', `${r.rota}/${r.id}/restore`, tokenAdmin).expect(200);
      });

      it('FLEET_MANAGER conforme o papel padrão', async () => {
        const r = recurso();
        if (r.gerentePode) {
          await autenticado('delete', `${r.rota}/${r.id}`, gerente.token).expect(204);
          await autenticado('get', `${r.rota}/deleted/all`, gerente.token).expect(200);
          await autenticado('patch', `${r.rota}/${r.id}/restore`, gerente.token).expect(200);
        } else {
          await autenticado('delete', `${r.rota}/${r.id}`, gerente.token).expect(403);
          await autenticado('get', `${r.rota}/deleted/all`, gerente.token).expect(403);
          await autenticado('patch', `${r.rota}/${r.id}/restore`, gerente.token).expect(403);
        }
      });

      it('permanent continua 403 para FLEET_MANAGER mesmo com delete/restore delegados', async () => {
        const r = recurso();
        await conceder(gerente.id, `${r.prefixo}_DELETE`);
        await conceder(gerente.id, `${r.prefixo}_RESTORE`);
        await autenticado('delete', `${r.rota}/${r.id}/permanent`, gerente.token).expect(403);
        await revogar(gerente.id, `${r.prefixo}_DELETE`);
        await revogar(gerente.id, `${r.prefixo}_RESTORE`);
      });

      if (!['vehicles', 'maintenances', 'incidents'].includes(nomeRecurso)) {
        it('delegação libera e a revogação bloqueia de novo', async () => {
          const r = recurso();
          await conceder(gerente.id, `${r.prefixo}_DELETE`);
          await conceder(gerente.id, `${r.prefixo}_RESTORE`);
          await autenticado('delete', `${r.rota}/${r.id}`, gerente.token).expect(204);
          await autenticado('get', `${r.rota}/deleted/all`, gerente.token).expect(200);
          await autenticado('patch', `${r.rota}/${r.id}/restore`, gerente.token).expect(200);

          await revogar(gerente.id, `${r.prefixo}_DELETE`);
          await revogar(gerente.id, `${r.prefixo}_RESTORE`);
          await autenticado('delete', `${r.rota}/${r.id}`, gerente.token).expect(403);
          await autenticado('get', `${r.rota}/deleted/all`, gerente.token).expect(403);
          await autenticado('patch', `${r.rota}/${r.id}/restore`, gerente.token).expect(403);
        });
      }
    });
  }

  it('isActive de vehicle e maintenance acompanha soft delete e restore', async () => {
    const veiculo = recursos.find((item) => item.nome === 'vehicles') as Recurso;
    const manutencao = recursos.find((item) => item.nome === 'maintenances') as Recurso;

    await autenticado('delete', `/vehicles/${veiculo.id}`, tokenAdmin).expect(204);
    let linha = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
    expect(linha?.isActive).toBe(false);
    expect(linha?.deletedAt).not.toBeNull();
    const restaurado = await autenticado('patch', `/vehicles/${veiculo.id}/restore`, tokenAdmin).expect(200);
    expect(restaurado.body.isActive).toBe(true);
    linha = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
    expect(linha?.isActive).toBe(true);

    await autenticado('delete', `/maintenances/${manutencao.id}`, tokenAdmin).expect(204);
    let linhaManutencao = await prisma.maintenance.findUnique({ where: { id: manutencao.id } });
    expect(linhaManutencao?.isActive).toBe(false);
    const listaRemovidos = await autenticado('get', '/maintenances/deleted/all', tokenAdmin).expect(200);
    expect(JSON.stringify(listaRemovidos.body)).toContain('isActive');
    await autenticado('patch', `/maintenances/${manutencao.id}/restore`, tokenAdmin).expect(200);
    linhaManutencao = await prisma.maintenance.findUnique({ where: { id: manutencao.id } });
    expect(linhaManutencao?.isActive).toBe(true);
  });

  it('isActive não pode ser alterado por PATCH de veículo', async () => {
    const veiculo = recursos.find((item) => item.nome === 'vehicles') as Recurso;
    await autenticado('patch', `/vehicles/${veiculo.id}`, tokenAdmin)
      .send({ isActive: false })
      .expect(400);
  });
});
