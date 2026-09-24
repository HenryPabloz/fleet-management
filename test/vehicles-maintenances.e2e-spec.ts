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
// Alguns testes chamam a API pública real do ViaCEP (sem mock), que às vezes devolve 5xx/502.
// Até 2 novas tentativas absorvem essa oscilação externa; falha de verdade continua falhando.
jest.retryTimes(2, { logErrorsBeforeRetry: true });

describe('Vehicles e Maintenances (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicoJwt: JwtService;
  let tokenAdmin: string;
  let tokenDriver: string;
  let userIdAdmin: string;
  let roleIdDriver: string;

  // Limpeza no final: ids criados neste arquivo de teste.
  const idsDeVeiculoParaLimpar: string[] = [];
  const idsDeUsuarioParaLimpar: string[] = [];
  const idsDeDriverParaLimpar: string[] = [];
  const idsDeTripParaLimpar: string[] = [];

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
    return `e2e-vm-${randomBytes(6).toString('hex')}@test.local`;
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

    const admin = await prisma.user.findUnique({
      where: { email: process.env.ADMIN_EMAIL as string },
    });
    if (!admin) {
      throw new Error('Admin do seed não encontrado.');
    }
    userIdAdmin = admin.id;

    const papelDriver = await prisma.role.findUnique({
      where: { name: 'DRIVER' },
    });
    if (!papelDriver) {
      throw new Error('Papel DRIVER não encontrado. O seed foi executado?');
    }
    roleIdDriver = papelDriver.id;

    // Usuário DRIVER para testar as restrições de RBAC (token assinado direto,
    // sem passar pelo login por API key).
    const usuarioDriver = await autenticado(tokenAdmin, 'post', '/users')
      .send({
        email: novoEmail(),
        password: SENHA,
        fullName: 'Motorista Teste Vehicles',
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
      if (idsDeTripParaLimpar.length > 0) {
        await prisma.trip.deleteMany({
          where: { id: { in: idsDeTripParaLimpar } },
        });
      }
      if (idsDeDriverParaLimpar.length > 0) {
        await prisma.driver.deleteMany({
          where: { id: { in: idsDeDriverParaLimpar } },
        });
      }
      if (idsDeUsuarioParaLimpar.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: idsDeUsuarioParaLimpar } },
        });
      }
      if (idsDeVeiculoParaLimpar.length > 0) {
        await prisma.maintenance.deleteMany({
          where: { vehicleId: { in: idsDeVeiculoParaLimpar } },
        });
        await prisma.vehicle.deleteMany({
          where: { id: { in: idsDeVeiculoParaLimpar } },
        });
      }
    }
    if (app) {
      await app.close();
    }
  });

  describe('Vehicles: CRUD básico + soft delete', () => {
    let idVeiculo: string;

    it('POST /vehicles cria um veículo disponível', async () => {
      const veiculo = await criarVeiculo();
      idVeiculo = veiculo.id;
      expect(veiculo.status).toEqual('AVAILABLE');
      expect(veiculo.plate).toMatch(/^[A-Z0-9]{7,8}$/);
    });

    it('GET /vehicles lista o veículo criado (paginado)', async () => {
      const resposta = await autenticado(tokenAdmin, 'get', '/vehicles?pageSize=100').expect(
        200,
      );
      const ids = resposta.body.data.map((item: { id: string }) => item.id);
      expect(ids).toContain(idVeiculo);
    });

    it('GET /vehicles/:id busca por id', async () => {
      const resposta = await autenticado(tokenAdmin, 'get', `/vehicles/${idVeiculo}`).expect(
        200,
      );
      expect(resposta.body.id).toEqual(idVeiculo);
    });

    it('PATCH /vehicles/:id atualiza parcialmente', async () => {
      const resposta = await autenticado(tokenAdmin, 'patch', `/vehicles/${idVeiculo}`)
        .send({ model: 'Fiat Strada Endurance' })
        .expect(200);
      expect(resposta.body.model).toEqual('Fiat Strada Endurance');
    });

    it('PUT /vehicles/:id substitui o veículo', async () => {
      const resposta = await autenticado(tokenAdmin, 'put', `/vehicles/${idVeiculo}`)
        .send({
          model: 'Fiat Strada Volcano',
          year: 2023,
          status: 'AVAILABLE',
          currentMileage: 2000,
          lastMaintenanceKm: 0,
        })
        .expect(200);
      expect(resposta.body.model).toEqual('Fiat Strada Volcano');
      expect(resposta.body.currentMileage).toEqual(2000);
    });

    it('DELETE /vehicles/:id faz soft delete', async () => {
      await autenticado(tokenAdmin, 'delete', `/vehicles/${idVeiculo}`).expect(204);

      const noBanco = await prisma.vehicle.findUnique({ where: { id: idVeiculo } });
      expect(noBanco?.deletedAt).not.toBeNull();

      await autenticado(tokenAdmin, 'get', `/vehicles/${idVeiculo}`).expect(404);
    });

    it('GET /vehicles/deleted/all mostra o veículo removido', async () => {
      const resposta = await autenticado(
        tokenAdmin,
        'get',
        '/vehicles/deleted/all?pageSize=100',
      ).expect(200);
      const ids = resposta.body.data.map((item: { id: string }) => item.id);
      expect(ids).toContain(idVeiculo);
    });

    it('PATCH /vehicles/:id/restore volta a aparecer', async () => {
      await autenticado(tokenAdmin, 'patch', `/vehicles/${idVeiculo}/restore`).expect(200);

      const noBanco = await prisma.vehicle.findUnique({ where: { id: idVeiculo } });
      expect(noBanco?.deletedAt).toBeNull();
    });

    it('DELETE /vehicles/:id/permanent apaga de vez', async () => {
      await autenticado(tokenAdmin, 'delete', `/vehicles/${idVeiculo}`).expect(204);
      await autenticado(tokenAdmin, 'delete', `/vehicles/${idVeiculo}/permanent`).expect(204);

      const noBanco = await prisma.vehicle.findUnique({ where: { id: idVeiculo } });
      expect(noBanco).toBeNull();

      const posicao = idsDeVeiculoParaLimpar.indexOf(idVeiculo);
      if (posicao !== -1) {
        idsDeVeiculoParaLimpar.splice(posicao, 1);
      }
    });
  });

  describe('Vehicles: regras de negócio', () => {
    it('POST /vehicles com status IN_USE dá 400 (bloqueado no DTO)', async () => {
      await autenticado(tokenAdmin, 'post', '/vehicles')
        .send({
          plate: novaPlaca(),
          model: 'Fiat Strada',
          year: 2022,
          status: 'IN_USE',
        })
        .expect(400);
    });

    it('PATCH /vehicles/:id com status IN_USE dá 400 (bloqueado no DTO)', async () => {
      const veiculo = await criarVeiculo();
      await autenticado(tokenAdmin, 'patch', `/vehicles/${veiculo.id}`)
        .send({ status: 'IN_USE' })
        .expect(400);
    });

    it('PATCH /vehicles/:id com currentMileage menor que o atual dá 409 (trigger do banco)', async () => {
      const veiculo = await criarVeiculo({ currentMileage: 5000 });
      await autenticado(tokenAdmin, 'patch', `/vehicles/${veiculo.id}`)
        .send({ currentMileage: 1000 })
        .expect(409);
    });

    it('POST /vehicles com placa duplicada dá 409', async () => {
      const veiculo = await criarVeiculo();
      await autenticado(tokenAdmin, 'post', '/vehicles')
        .send({ plate: veiculo.plate, model: 'Outro modelo', year: 2020 })
        .expect(409);
    });

    // Não dá pra criar um veículo IN_USE pela API (o DTO bloqueia e o trigger
    // de insert também). Simulamos uma viagem ativa gravando o Trip direto
    // via Prisma: o trigger trg_sync_vehicle_from_trip marca o veículo como
    // IN_USE sozinho, do mesmo jeito que aconteceria com o resource de Trips.
    it('DELETE /vehicles/:id com veículo IN_USE (viagem ativa) dá 409', async () => {
      const veiculo = await criarVeiculo();

      const usuarioMotorista = await autenticado(tokenAdmin, 'post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Motorista Teste Trip',
          roleId: roleIdDriver,
          driver: { licenseNumber: novaCnh(), licenseExpiry: dataFuturaIso() },
        })
        .expect(201);
      idsDeUsuarioParaLimpar.push(usuarioMotorista.body.id);

      const driver = { body: { ...usuarioMotorista.body.driver, userId: usuarioMotorista.body.id } };
      idsDeDriverParaLimpar.push(driver.body.id);

      const trip = await prisma.trip.create({
        data: {
          driverId: driver.body.id,
          vehicleId: veiculo.id,
          status: 'PLANNED',
          startKm: veiculo.currentMileage,
          startLocation: 'São Paulo, SP',
          endLocation: 'Rio de Janeiro, RJ',
          createdBy: userIdAdmin,
        },
      });
      idsDeTripParaLimpar.push(trip.id);

      const veiculoAtualizado = await prisma.vehicle.findUnique({
        where: { id: veiculo.id },
      });
      expect(veiculoAtualizado?.status).toEqual('IN_USE');

      await autenticado(tokenAdmin, 'delete', `/vehicles/${veiculo.id}`).expect(409);

      // Encerra a viagem: o mesmo trigger devolve o veículo para AVAILABLE.
      await prisma.trip.delete({ where: { id: trip.id } });
      const posicao = idsDeTripParaLimpar.indexOf(trip.id);
      if (posicao !== -1) {
        idsDeTripParaLimpar.splice(posicao, 1);
      }
      const veiculoLiberado = await prisma.vehicle.findUnique({
        where: { id: veiculo.id },
      });
      expect(veiculoLiberado?.status).toEqual('AVAILABLE');
    });
  });

  describe('Vehicles: RBAC', () => {
    it('GET /vehicles sem token dá 401', async () => {
      await request(app.getHttpServer()).get('/vehicles').expect(401);
    });

    it('GET /vehicles com token de DRIVER é permitido', async () => {
      await autenticado(tokenDriver, 'get', '/vehicles').expect(200);
    });

    it('POST /vehicles com token de DRIVER dá 403', async () => {
      await autenticado(tokenDriver, 'post', '/vehicles')
        .send({ plate: novaPlaca(), model: 'Fiat Strada', year: 2022 })
        .expect(403);
    });
  });

  describe('Maintenances: sincronia com Vehicle.status', () => {
    it('criar manutenção SCHEDULED muda o veículo para IN_MAINTENANCE', async () => {
      const veiculo = await criarVeiculo();

      const manutencao = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'PREVENTIVE',
          scheduledDate: new Date().toISOString(),
          description: 'Troca de óleo e filtros',
          cost: 350.5,
        })
        .expect(201);
      expect(manutencao.body.status).toEqual('SCHEDULED');
      expect(manutencao.body.registeredBy).toEqual(userIdAdmin);

      const veiculoNoBanco = await prisma.vehicle.findUnique({
        where: { id: veiculo.id },
      });
      expect(veiculoNoBanco?.status).toEqual('IN_MAINTENANCE');
    });

    it('completar a manutenção volta o veículo para AVAILABLE e atualiza lastMaintenanceKm', async () => {
      const veiculo = await criarVeiculo({ currentMileage: 8000 });

      const manutencao = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'CORRECTIVE',
          scheduledDate: new Date().toISOString(),
          description: 'Troca de pastilhas de freio',
          cost: 500,
        })
        .expect(201);

      let veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('IN_MAINTENANCE');

      const respostaConcluida = await autenticado(
        tokenAdmin,
        'patch',
        `/maintenances/${manutencao.body.id}`,
      )
        .send({ status: 'COMPLETED' })
        .expect(200);
      expect(respostaConcluida.body.completedDate).not.toBeNull();

      veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('AVAILABLE');
      expect(veiculoNoBanco?.lastMaintenanceKm).toEqual(8000);
    });

    it('concluir uma manutenção não libera o veículo se houver outra manutenção ativa', async () => {
      const veiculo = await criarVeiculo();

      const primeira = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'PREVENTIVE',
          scheduledDate: new Date().toISOString(),
          description: 'Revisão programada',
          cost: 200,
        })
        .expect(201);

      const segunda = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'INSPECTION',
          scheduledDate: new Date().toISOString(),
          description: 'Inspeção veicular',
          cost: 100,
        })
        .expect(201);

      await autenticado(tokenAdmin, 'patch', `/maintenances/${primeira.body.id}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      const veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('IN_MAINTENANCE');

      await autenticado(tokenAdmin, 'patch', `/maintenances/${segunda.body.id}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      const veiculoLiberado = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoLiberado?.status).toEqual('AVAILABLE');
    });

    // BUG 2 corrigido: soft delete de uma manutenção ativa (SCHEDULED/IN_PROGRESS)
    // agora reverte o veículo pra AVAILABLE quando não sobra outra manutenção
    // ativa — antes ficava preso em IN_MAINTENANCE para sempre.
    it('DELETE /maintenances/:id (soft delete) de uma manutenção ativa devolve o veículo para AVAILABLE', async () => {
      const veiculo = await criarVeiculo();

      const manutencao = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'PREVENTIVE',
          scheduledDate: new Date().toISOString(),
          description: 'Manutenção que vai ser removida antes de concluir',
          cost: 180,
        })
        .expect(201);

      let veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('IN_MAINTENANCE');

      await autenticado(tokenAdmin, 'delete', `/maintenances/${manutencao.body.id}`).expect(204);

      veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('AVAILABLE');
    });

    it('DELETE /maintenances/:id só libera o veículo quando não sobra outra manutenção ativa', async () => {
      const veiculo = await criarVeiculo();

      const primeira = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'PREVENTIVE',
          scheduledDate: new Date().toISOString(),
          description: 'Primeira manutenção ativa (BUG 2)',
          cost: 100,
        })
        .expect(201);

      const segunda = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'INSPECTION',
          scheduledDate: new Date().toISOString(),
          description: 'Segunda manutenção ativa (BUG 2)',
          cost: 90,
        })
        .expect(201);

      // Remove só a primeira: a segunda ainda está ativa, veículo continua preso.
      await autenticado(tokenAdmin, 'delete', `/maintenances/${primeira.body.id}`).expect(204);
      let veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('IN_MAINTENANCE');

      // Remove a segunda também: agora sim libera.
      await autenticado(tokenAdmin, 'delete', `/maintenances/${segunda.body.id}`).expect(204);
      veiculoNoBanco = await prisma.vehicle.findUnique({ where: { id: veiculo.id } });
      expect(veiculoNoBanco?.status).toEqual('AVAILABLE');
    });
  });

  describe('Maintenances: completar com scheduledDate futura', () => {
    it('PATCH status COMPLETED sem completedDate e scheduledDate futura dá 400 (não 500)', async () => {
      const veiculo = await criarVeiculo();
      const dataFutura = new Date();
      dataFutura.setDate(dataFutura.getDate() + 5);

      const manutencao = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'PREVENTIVE',
          scheduledDate: dataFutura.toISOString(),
          description: 'Revisão agendada para o futuro',
          cost: 250,
        })
        .expect(201);

      const resposta = await autenticado(
        tokenAdmin,
        'patch',
        `/maintenances/${manutencao.body.id}`,
      )
        .send({ status: 'COMPLETED' })
        .expect(400);
      expect(resposta.body.detail).toContain('completedDate cannot be before scheduledDate');
    });

    it('PATCH com completedDate explícito anterior a scheduledDate dá 400', async () => {
      const veiculo = await criarVeiculo();
      const dataFutura = new Date();
      dataFutura.setDate(dataFutura.getDate() + 5);
      const dataAnterior = new Date();
      dataAnterior.setDate(dataAnterior.getDate() + 1);

      const manutencao = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'PREVENTIVE',
          scheduledDate: dataFutura.toISOString(),
          description: 'Revisão agendada para o futuro',
          cost: 250,
        })
        .expect(201);

      await autenticado(tokenAdmin, 'patch', `/maintenances/${manutencao.body.id}`)
        .send({ status: 'COMPLETED', completedDate: dataAnterior.toISOString() })
        .expect(400);
    });

    it('PATCH status COMPLETED sem completedDate e scheduledDate no passado continua funcionando (200)', async () => {
      const veiculo = await criarVeiculo();
      const dataPassada = new Date();
      dataPassada.setDate(dataPassada.getDate() - 1);

      const manutencao = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: veiculo.id,
          type: 'PREVENTIVE',
          scheduledDate: dataPassada.toISOString(),
          description: 'Revisão agendada no passado',
          cost: 250,
        })
        .expect(201);

      const resposta = await autenticado(
        tokenAdmin,
        'patch',
        `/maintenances/${manutencao.body.id}`,
      )
        .send({ status: 'COMPLETED' })
        .expect(200);
      expect(resposta.body.completedDate).not.toBeNull();
    });
  });

  describe('Maintenances: CRUD básico + soft delete', () => {
    let idVeiculo: string;
    let idManutencao: string;

    beforeAll(async () => {
      const veiculo = await criarVeiculo();
      idVeiculo = veiculo.id;
    });

    it('POST /maintenances cria uma manutenção', async () => {
      const resposta = await autenticado(tokenAdmin, 'post', '/maintenances')
        .send({
          vehicleId: idVeiculo,
          type: 'INSPECTION',
          scheduledDate: new Date().toISOString(),
          description: 'Inspeção anual',
          cost: 150,
        })
        .expect(201);
      idManutencao = resposta.body.id;
    });

    it('GET /maintenances lista (paginado, com filtro por vehicleId)', async () => {
      const resposta = await autenticado(
        tokenAdmin,
        'get',
        `/maintenances?vehicleId=${idVeiculo}&pageSize=100`,
      ).expect(200);
      const ids = resposta.body.data.map((item: { id: string }) => item.id);
      expect(ids).toContain(idManutencao);
    });

    it('GET /maintenances/:id busca por id', async () => {
      const resposta = await autenticado(
        tokenAdmin,
        'get',
        `/maintenances/${idManutencao}`,
      ).expect(200);
      expect(resposta.body.id).toEqual(idManutencao);
    });

    it('PATCH /maintenances/:id atualiza parcialmente', async () => {
      const resposta = await autenticado(
        tokenAdmin,
        'patch',
        `/maintenances/${idManutencao}`,
      )
        .send({ description: 'Inspeção anual (revisada)' })
        .expect(200);
      expect(resposta.body.description).toEqual('Inspeção anual (revisada)');
    });

    it('PUT /maintenances/:id substitui a manutenção', async () => {
      const resposta = await autenticado(tokenAdmin, 'put', `/maintenances/${idManutencao}`)
        .send({
          type: 'INSPECTION',
          status: 'IN_PROGRESS',
          scheduledDate: new Date().toISOString(),
          description: 'Inspeção anual em andamento',
          cost: 180,
        })
        .expect(200);
      expect(resposta.body.status).toEqual('IN_PROGRESS');
    });

    it('DELETE /maintenances/:id faz soft delete', async () => {
      await autenticado(tokenAdmin, 'delete', `/maintenances/${idManutencao}`).expect(204);

      const noBanco = await prisma.maintenance.findUnique({ where: { id: idManutencao } });
      expect(noBanco?.deletedAt).not.toBeNull();

      await autenticado(tokenAdmin, 'get', `/maintenances/${idManutencao}`).expect(404);
    });

    it('GET /maintenances/deleted/all mostra a manutenção removida', async () => {
      const resposta = await autenticado(
        tokenAdmin,
        'get',
        '/maintenances/deleted/all?pageSize=100',
      ).expect(200);
      const ids = resposta.body.data.map((item: { id: string }) => item.id);
      expect(ids).toContain(idManutencao);
    });

    it('PATCH /maintenances/:id/restore volta a aparecer', async () => {
      await autenticado(tokenAdmin, 'patch', `/maintenances/${idManutencao}/restore`).expect(
        200,
      );
      const noBanco = await prisma.maintenance.findUnique({ where: { id: idManutencao } });
      expect(noBanco?.deletedAt).toBeNull();
    });

    it('DELETE /maintenances/:id/permanent apaga de vez', async () => {
      await autenticado(tokenAdmin, 'delete', `/maintenances/${idManutencao}`).expect(204);
      await autenticado(
        tokenAdmin,
        'delete',
        `/maintenances/${idManutencao}/permanent`,
      ).expect(204);

      const noBanco = await prisma.maintenance.findUnique({ where: { id: idManutencao } });
      expect(noBanco).toBeNull();
    });
  });

  describe('Maintenances: RBAC', () => {
    it('GET /maintenances com token de DRIVER dá 403 (motorista não mexe em manutenção)', async () => {
      await autenticado(tokenDriver, 'get', '/maintenances').expect(403);
    });

    it('GET /maintenances sem token dá 401', async () => {
      await request(app.getHttpServer()).get('/maintenances').expect(401);
    });
  });

  // Chamada real à API do ViaCEP, sem mock. O campo é opcional e só enriquece
  // a resposta; não vira coluna no banco (por isso não conferimos o Prisma aqui).
  describe('Vehicles: initialLocationCep (ViaCEP)', () => {
    it('POST /vehicles com initialLocationCep válido devolve initialLocation enriquecido', async () => {
      const resposta = await autenticado(tokenAdmin, 'post', '/vehicles')
        .send({
          plate: novaPlaca(),
          model: 'Fiat Strada',
          year: 2022,
          currentMileage: 1000,
          initialLocationCep: '01310-100',
        })
        .expect(201);
      idsDeVeiculoParaLimpar.push(resposta.body.id);

      expect(resposta.body.initialLocation).toBeDefined();
      expect(resposta.body.initialLocation.localidade).toEqual('São Paulo');
      expect(resposta.body.initialLocation.uf).toEqual('SP');
    });

    it('POST /vehicles com initialLocationCep inválido dá 400', async () => {
      await autenticado(tokenAdmin, 'post', '/vehicles')
        .send({
          plate: novaPlaca(),
          model: 'Fiat Strada',
          year: 2022,
          currentMileage: 1000,
          initialLocationCep: '00000-000',
        })
        .expect(400);
    });

    it('POST /vehicles sem initialLocationCep continua funcionando normalmente', async () => {
      const resposta = await autenticado(tokenAdmin, 'post', '/vehicles')
        .send({
          plate: novaPlaca(),
          model: 'Fiat Strada',
          year: 2022,
          currentMileage: 1000,
        })
        .expect(201);
      idsDeVeiculoParaLimpar.push(resposta.body.id);

      expect(resposta.body.initialLocation).toBeUndefined();
    });
  });

  describe('Vehicles: filtro por status na listagem', () => {
    it('GET /vehicles?status=AVAILABLE só devolve veículos AVAILABLE', async () => {
      const disponivel = await criarVeiculo({ status: 'AVAILABLE' });
      const emManutencao = await criarVeiculo({ status: 'IN_MAINTENANCE' });

      const resposta = await autenticado(
        tokenAdmin,
        'get',
        '/vehicles?status=AVAILABLE&pageSize=100',
      ).expect(200);

      const ids = resposta.body.data.map((item: { id: string }) => item.id);
      expect(ids).toContain(disponivel.id);
      expect(ids).not.toContain(emManutencao.id);
      for (const veiculo of resposta.body.data) {
        expect(veiculo.status).toEqual('AVAILABLE');
      }
    });
  });

describe('Vehicles: em uso e fora de uso', () => {
    let idEmUso: string;
    let idDisponivel: string;
    let idEmManutencao: string;

    async function ids(caminho: string): Promise<string[]> {
      const resposta = await autenticado(tokenAdmin, 'get', caminho).expect(200);
      return resposta.body.data.map((item: { id: string }) => item.id);
    }

    it('cria veículos AVAILABLE, IN_MAINTENANCE e um IN_USE (viagem)', async () => {
      const emUso = await criarVeiculo();
      const disponivel = await criarVeiculo();
      const emManutencao = await criarVeiculo({ status: 'IN_MAINTENANCE' });
      idEmUso = emUso.id;
      idDisponivel = disponivel.id;
      idEmManutencao = emManutencao.id;

      const usuario = await autenticado(tokenAdmin, 'post', '/users')
        .send({
          email: novoEmail(),
          password: SENHA,
          fullName: 'Motorista Teste Em Uso',
          roleId: roleIdDriver,
          driver: { licenseNumber: novaCnh(), licenseExpiry: dataFuturaIso() },
        })
        .expect(201);
      idsDeUsuarioParaLimpar.push(usuario.body.id);

      const driver = { body: { ...usuario.body.driver, userId: usuario.body.id } };
      idsDeDriverParaLimpar.push(driver.body.id);

      // O trigger do banco marca o veículo como IN_USE ao criar a viagem.
      const trip = await prisma.trip.create({
        data: {
          driverId: driver.body.id,
          vehicleId: idEmUso,
          status: 'PLANNED',
          startKm: emUso.currentMileage,
          startLocation: 'São Paulo, SP',
          endLocation: 'Campinas, SP',
          createdBy: userIdAdmin,
        },
      });
      idsDeTripParaLimpar.push(trip.id);
    });

    it('GET /vehicles/in-use traz só o veículo em uso', async () => {
      const lista = await ids('/vehicles/in-use?pageSize=100');
      expect(lista).toContain(idEmUso);
      expect(lista).not.toContain(idDisponivel);
      expect(lista).not.toContain(idEmManutencao);
      const resposta = await autenticado(tokenAdmin, 'get', '/vehicles/in-use?pageSize=100').expect(200);
      for (const veiculo of resposta.body.data) {
        expect(veiculo.status).toEqual('IN_USE');
      }
    });

    it('GET /vehicles/not-in-use traz os não usados e nenhum IN_USE', async () => {
      const lista = await ids('/vehicles/not-in-use?pageSize=100');
      expect(lista).toContain(idDisponivel);
      expect(lista).toContain(idEmManutencao);
      expect(lista).not.toContain(idEmUso);
      const resposta = await autenticado(tokenAdmin, 'get', '/vehicles/not-in-use?pageSize=100').expect(200);
      for (const veiculo of resposta.body.data) {
        expect(veiculo.status).not.toEqual('IN_USE');
      }
    });

    it('GET /vehicles/not-in-use?status=IN_MAINTENANCE filtra e status=IN_USE dá 400', async () => {
      const resposta = await autenticado(
        tokenAdmin,
        'get',
        '/vehicles/not-in-use?status=IN_MAINTENANCE&pageSize=100',
      ).expect(200);
      for (const veiculo of resposta.body.data) {
        expect(veiculo.status).toEqual('IN_MAINTENANCE');
      }
      await autenticado(tokenAdmin, 'get', '/vehicles/not-in-use?status=IN_USE').expect(400);
    });

    it('em uso + fora de uso = total de GET /vehicles', async () => {
      // Outros testes podem criar veículos ao mesmo tempo; tenta algumas vezes.
      let bateu = false;
      for (let tentativa = 0; tentativa < 5 && !bateu; tentativa++) {
        const emUso = await autenticado(tokenAdmin, 'get', '/vehicles/in-use').expect(200);
        const foraDeUso = await autenticado(tokenAdmin, 'get', '/vehicles/not-in-use').expect(200);
        const todos = await autenticado(tokenAdmin, 'get', '/vehicles').expect(200);
        const soma = emUso.body.pagination.total + foraDeUso.body.pagination.total;
        if (soma === todos.body.pagination.total) {
          bateu = true;
        }
      }
      expect(bateu).toBe(true);
    });

    it('GET /vehicles/in-use e not-in-use: DRIVER pode (200), sem token dá 401', async () => {
      await autenticado(tokenDriver, 'get', '/vehicles/in-use').expect(200);
      await autenticado(tokenDriver, 'get', '/vehicles/not-in-use').expect(200);
      await request(app.getHttpServer()).get('/vehicles/in-use').expect(401);
    });
  });
});
