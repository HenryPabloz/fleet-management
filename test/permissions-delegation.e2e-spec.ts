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

describe('Delegação granular de permissões (UserPermission) (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  let roleIdFleetManager: string;
  let roleIdDriver: string;

  const idsDeUsuarioParaLimpar: string[] = [];
  const idsDeVeiculoParaLimpar: string[] = [];

  function novoEmail(): string {
    return `e2e-perm-${randomBytes(6).toString('hex')}@test.local`;
  }

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

  function autenticado(
    metodo: 'get' | 'post' | 'patch' | 'put' | 'delete',
    caminho: string,
    token: string,
  ) {
    return request(app.getHttpServer())
      [metodo](caminho)
      .set('Authorization', `Bearer ${token}`);
  }

  // /auth/signup sempre cria DRIVER; quando o papel pedido for outro, ajusta
  // via PATCH (ADMIN) depois. A x-api-key devolvida no signup é a do próprio
  // usuário (POST /users, feito por ADMIN, não devolve apiKey por segurança).
  async function criarUsuarioELogar(roleId: string, nome: string) {
    const email = novoEmail();
    const cadastro = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: SENHA, fullName: nome })
      .expect(201);
    const id = cadastro.body.userId as string;
    const chave = cadastro.body.apiKey as string;
    idsDeUsuarioParaLimpar.push(id);

    if (roleId !== roleIdDriver) {
      await autenticado('patch', `/users/${id}`, tokenAdmin)
        .send({ roleId })
        .expect(200);
    }

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', chave)
      .send({ email, password: SENHA })
      .expect(200);

    return { id, token: login.body.accessToken as string };
  }

  // Ciclo padrão pra uma rota de leitura simples (GET, sem corpo): confirma
  // 403 sem a permission, concede, confirma 200, revoga, confirma 403 de novo.
  // Usa DRIVER como sujeito porque é o papel que genuinamente não tem essas
  // permissions por padrão (ver comentário na descrição da Tarefa 1 no relatório).
  async function cicloDeDelegacaoLeitura(
    nomeCaso: string,
    permissionCode: string,
    caminho: string,
  ) {
    const usuario = await criarUsuarioELogar(roleIdDriver, `Driver ${nomeCaso}`);

    await autenticado('get', caminho, usuario.token).expect(403);

    await autenticado('post', `/users/${usuario.id}/permissions`, tokenAdmin)
      .send({ permissionCode })
      .expect(200);
    await autenticado('get', caminho, usuario.token).expect(200);

    await autenticado(
      'delete',
      `/users/${usuario.id}/permissions/${permissionCode}`,
      tokenAdmin,
    ).expect(204);
    await autenticado('get', caminho, usuario.token).expect(403);
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

    const respostaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', process.env.ADMIN_API_KEY as string)
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      })
      .expect(200);
    tokenAdmin = respostaLogin.body.accessToken;

    const papelFleetManager = await prisma.role.findUnique({
      where: { name: 'FLEET_MANAGER' },
    });
    const papelDriver = await prisma.role.findUnique({
      where: { name: 'DRIVER' },
    });
    if (!papelFleetManager || !papelDriver) {
      throw new Error('Papéis FLEET_MANAGER/DRIVER não encontrados. O seed foi executado?');
    }
    roleIdFleetManager = papelFleetManager.id;
    roleIdDriver = papelDriver.id;
  });

  afterAll(async () => {
    if (prisma && idsDeUsuarioParaLimpar.length > 0) {
      // Histórico de auditoria não bloqueia mais: as linhas de audit_logs ficam com autor NULL.
      await prisma.userPermission.deleteMany({
        where: { userId: { in: idsDeUsuarioParaLimpar } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: idsDeUsuarioParaLimpar } },
      });
    }
    if (prisma && idsDeVeiculoParaLimpar.length > 0) {
      await prisma.vehicle.deleteMany({
        where: { id: { in: idsDeVeiculoParaLimpar } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('GET /permissions (ADMIN) lista o catálogo completo', async () => {
    const resposta = await autenticado('get', '/permissions', tokenAdmin).expect(200);
    const codigos = resposta.body.map((item: { code: string }) => item.code);
    expect(codigos).toEqual(expect.arrayContaining(['USER_CREATE', 'USER_UPDATE', 'USER_DELETE']));
  });

  it('GET /permissions sem ser ADMIN dá 403', async () => {
    const fleetManager = await criarUsuarioELogar(roleIdFleetManager, 'FM Teste Catalogo');
    await autenticado('get', '/permissions', fleetManager.token).expect(403);
  });

  describe('FLEET_MANAGER sem concessão nenhuma', () => {
    it('POST /users dá 403 (sem USER_CREATE)', async () => {
      const fleetManager = await criarUsuarioELogar(roleIdFleetManager, 'FM Sem Permissao');
      await autenticado('post', '/users', fleetManager.token)
        .send({ email: novoEmail(), password: SENHA, fullName: 'X', roleId: roleIdDriver })
        .expect(403);
    });
  });

  describe('Ciclo completo: conceder USER_CREATE a um FLEET_MANAGER e revogar', () => {
    let fleetManager: { id: string; token: string };

    beforeAll(async () => {
      fleetManager = await criarUsuarioELogar(roleIdFleetManager, 'FM Ciclo Delegacao');
    });

    it('GET /users/:id/permissions mostra fromRole vazio de USER_CREATE e individual vazio', async () => {
      const resposta = await autenticado(
        'get',
        `/users/${fleetManager.id}/permissions`,
        tokenAdmin,
      ).expect(200);
      expect(resposta.body.fromRole).not.toContain('USER_CREATE');
      expect(resposta.body.individual).toEqual([]);
    });

    it('POST /users como FLEET_MANAGER sem concessão dá 403', async () => {
      await autenticado('post', '/users', fleetManager.token)
        .send({ email: novoEmail(), password: SENHA, fullName: 'X', roleId: roleIdDriver })
        .expect(403);
    });

    it('POST /users/:id/permissions concede USER_CREATE (ADMIN)', async () => {
      const resposta = await autenticado(
        'post',
        `/users/${fleetManager.id}/permissions`,
        tokenAdmin,
      )
        .send({ permissionCode: 'USER_CREATE' })
        .expect(200);
      expect(resposta.body.individual).toContain('USER_CREATE');
    });

    it('POST /users/:id/permissions de novo é idempotente (ainda 200, sem duplicar)', async () => {
      await autenticado('post', `/users/${fleetManager.id}/permissions`, tokenAdmin)
        .send({ permissionCode: 'USER_CREATE' })
        .expect(200);

      const linhas = await prisma.userPermission.findMany({
        where: { userId: fleetManager.id },
      });
      expect(linhas.length).toEqual(1);
    });

    it('POST /users/:id/permissions com código inexistente dá 400', async () => {
      await autenticado('post', `/users/${fleetManager.id}/permissions`, tokenAdmin)
        .send({ permissionCode: 'CODIGO_QUE_NAO_EXISTE' })
        .expect(400);
    });

    it('agora o FLEET_MANAGER consegue POST /users (201)', async () => {
      const resposta = await autenticado('post', '/users', fleetManager.token)
        .send({ email: novoEmail(), password: SENHA, fullName: 'Criado Via Delegacao', roleId: roleIdDriver })
        .expect(201);
      idsDeUsuarioParaLimpar.push(resposta.body.id);
    });

    it('DELETE /users/:id/permanent continua 403 pro FLEET_MANAGER mesmo com USER_CREATE concedido', async () => {
      await autenticado('delete', `/users/${fleetManager.id}/permanent`, fleetManager.token).expect(403);
    });

    it('DELETE /users/:id/permissions/USER_CREATE revoga (ADMIN)', async () => {
      await autenticado(
        'delete',
        `/users/${fleetManager.id}/permissions/USER_CREATE`,
        tokenAdmin,
      ).expect(204);
    });

    it('DELETE de novo (já revogado) continua 204 (idempotente)', async () => {
      await autenticado(
        'delete',
        `/users/${fleetManager.id}/permissions/USER_CREATE`,
        tokenAdmin,
      ).expect(204);
    });

    it('volta a dar 403 em POST /users pro mesmo FLEET_MANAGER', async () => {
      await autenticado('post', '/users', fleetManager.token)
        .send({ email: novoEmail(), password: SENHA, fullName: 'X', roleId: roleIdDriver })
        .expect(403);
    });
  });

  describe('Reforço: hard delete continua bloqueado mesmo com USER_DELETE concedido', () => {
    // O teste original desse cenário usa USER_CREATE; esta variante cobre
    // especificamente USER_DELETE, que é a permission mais próxima "por
    // engano" de achar que libera o hard delete (ela só cobre o soft delete
    // de /users/:id e a restauração — o /permanent é carve-out, sempre @Roles('ADMIN')).
    it('DELETE /users/:id/permanent dá 403 pro FLEET_MANAGER mesmo com USER_DELETE concedido', async () => {
      const fleetManager = await criarUsuarioELogar(roleIdFleetManager, 'FM USER_DELETE Hard Delete');
      const alvo = await autenticado('post', '/users', tokenAdmin)
        .send({ email: novoEmail(), password: SENHA, fullName: 'Alvo Hard Delete', roleId: roleIdDriver })
        .expect(201);
      idsDeUsuarioParaLimpar.push(alvo.body.id);

      await autenticado('post', `/users/${fleetManager.id}/permissions`, tokenAdmin)
        .send({ permissionCode: 'USER_DELETE' })
        .expect(200);

      // Com USER_DELETE, o soft delete funciona normalmente...
      await autenticado('delete', `/users/${alvo.body.id}`, fleetManager.token).expect(204);
      await autenticado('patch', `/users/${alvo.body.id}/restore`, fleetManager.token).expect(200);

      // ...mas o hard delete continua bloqueado, mesmo com a permission concedida.
      await autenticado('delete', `/users/${alvo.body.id}/permanent`, fleetManager.token).expect(403);

      await autenticado(
        'delete',
        `/users/${fleetManager.id}/permissions/USER_DELETE`,
        tokenAdmin,
      ).expect(204);
    });
  });

  describe('Reforço: conceder PERMISSION_MANAGE/ROLE_MANAGE não libera o PermissionsController', () => {
    // PERMISSION_MANAGE e ROLE_MANAGE existem no catálogo mas não protegem
    // nenhuma rota real (carve-out de segurança deliberado: as 4 rotas de
    // /permissions continuam @Roles('ADMIN') puro, nunca @Permissions, pra
    // não abrir escalonamento em cadeia). Confirma que conceder as duas não
    // muda nada nas 4 rotas.
    it('FLEET_MANAGER com PERMISSION_MANAGE e ROLE_MANAGE continua 403 nas 4 rotas de /permissions', async () => {
      const fleetManager = await criarUsuarioELogar(
        roleIdFleetManager,
        'FM Permission Manage Inerte',
      );
      const alvo = await criarUsuarioELogar(roleIdDriver, 'Alvo Permission Manage Inerte');

      await autenticado('post', `/users/${fleetManager.id}/permissions`, tokenAdmin)
        .send({ permissionCode: 'PERMISSION_MANAGE' })
        .expect(200);
      await autenticado('post', `/users/${fleetManager.id}/permissions`, tokenAdmin)
        .send({ permissionCode: 'ROLE_MANAGE' })
        .expect(200);

      await autenticado('get', '/permissions', fleetManager.token).expect(403);
      await autenticado('get', `/users/${alvo.id}/permissions`, fleetManager.token).expect(403);
      await autenticado('post', `/users/${alvo.id}/permissions`, fleetManager.token)
        .send({ permissionCode: 'USER_CREATE' })
        .expect(403);
      await autenticado(
        'delete',
        `/users/${alvo.id}/permissions/USER_CREATE`,
        fleetManager.token,
      ).expect(403);

      await autenticado(
        'delete',
        `/users/${fleetManager.id}/permissions/PERMISSION_MANAGE`,
        tokenAdmin,
      ).expect(204);
      await autenticado(
        'delete',
        `/users/${fleetManager.id}/permissions/ROLE_MANAGE`,
        tokenAdmin,
      ).expect(204);
    });
  });

  describe('Ampliação da delegação granular: 7 controllers restantes', () => {
    // drivers, maintenances e analytics: DRIVER genuinamente não tem essas
    // permissions por padrão (não estão na lista base do papel no seed),
    // então dá pra provar o ciclo completo 403 -> concedida -> 200 -> revogada -> 403.
    it('drivers: DRIVER_VIEW libera GET /drivers (ciclo completo)', async () => {
      await cicloDeDelegacaoLeitura('Drivers View', 'DRIVER_VIEW', '/drivers');
    });

    it('maintenances: MAINTENANCE_VIEW_ALL libera GET /maintenances (ciclo completo)', async () => {
      await cicloDeDelegacaoLeitura(
        'Maintenances View',
        'MAINTENANCE_VIEW_ALL',
        '/maintenances',
      );
    });

    it('analytics: ANALYTICS_VIEW libera GET /analytics/fleet/fuel-consumption (ciclo completo)', async () => {
      await cicloDeDelegacaoLeitura(
        'Analytics View',
        'ANALYTICS_VIEW',
        '/analytics/fleet/fuel-consumption',
      );
    });

    it('vehicles: VEHICLE_CREATE libera POST /vehicles (ciclo completo)', async () => {
      const usuario = await criarUsuarioELogar(roleIdDriver, 'Driver Vehicle Create');
      const corpo = { plate: novaPlaca(), model: 'Fiat Strada', year: 2022 };

      await autenticado('post', '/vehicles', usuario.token).send(corpo).expect(403);

      await autenticado('post', `/users/${usuario.id}/permissions`, tokenAdmin)
        .send({ permissionCode: 'VEHICLE_CREATE' })
        .expect(200);
      const criado = await autenticado('post', '/vehicles', usuario.token).send(corpo).expect(201);
      idsDeVeiculoParaLimpar.push(criado.body.id);

      await autenticado(
        'delete',
        `/users/${usuario.id}/permissions/VEHICLE_CREATE`,
        tokenAdmin,
      ).expect(204);
      await autenticado('post', '/vehicles', usuario.token)
        .send({ plate: novaPlaca(), model: 'Fiat Strada', year: 2022 })
        .expect(403);
    });

    // trips, refuelings e incidents: os códigos que preservam o acesso atual
    // (TRIP_VIEW_OWN/ALL, REFUELING_VIEW_OWN/ALL, INCIDENT_VIEW_OWN/ALL,
    // TRIP_CREATE, REFUELING_CREATE, INCIDENT_CREATE, TRIP_CANCEL_OWN) já
    // pertencem a DRIVER, e FLEET_MANAGER os herda — nenhum dos 3 papéis
    // fica sem acesso a essas rotas por padrão (ver Retorno, item 1). Por
    // isso não existe um cenário 403 -> concedida pra provar aqui sem mexer
    // em role_permissions (fora de escopo). Em vez disso, confirmamos que a
    // troca pra @Permissions não regrediu o acesso que DRIVER já tinha.
    it('trips: DRIVER continua acessando GET /trips por papel (sem regressão pós-conversão)', async () => {
      const usuario = await criarUsuarioELogar(roleIdDriver, 'Driver Trips Regressao');
      await autenticado('get', '/trips', usuario.token).expect(200);
    });

    it('refuelings: DRIVER continua acessando GET /refuelings por papel (sem regressão pós-conversão)', async () => {
      const usuario = await criarUsuarioELogar(roleIdDriver, 'Driver Refuelings Regressao');
      await autenticado('get', '/refuelings', usuario.token).expect(200);
    });

    it('incidents: DRIVER continua acessando GET /incidents por papel (sem regressão pós-conversão)', async () => {
      const usuario = await criarUsuarioELogar(roleIdDriver, 'Driver Incidents Regressao');
      await autenticado('get', '/incidents', usuario.token).expect(200);
    });
  });

  it('ADMIN continua funcionando normalmente em tudo (papel já cobre, sem precisar de concessão)', async () => {
    const resposta = await autenticado('post', '/users', tokenAdmin)
      .send({ email: novoEmail(), password: SENHA, fullName: 'Criado Por Admin', roleId: roleIdDriver })
      .expect(201);
    idsDeUsuarioParaLimpar.push(resposta.body.id);

    await autenticado('patch', `/users/${resposta.body.id}`, tokenAdmin)
      .send({ fullName: 'Criado Por Admin Editado' })
      .expect(200);

    await autenticado('delete', `/users/${resposta.body.id}`, tokenAdmin).expect(204);
    await autenticado('patch', `/users/${resposta.body.id}/restore`, tokenAdmin).expect(200);
  });

  it('DRIVER sem nenhuma concessão dá 403 em POST /users, GET /permissions e GET /users/:id/permissions', async () => {
    const driver = await criarUsuarioELogar(roleIdDriver, 'Driver Sem Permissao');

    await autenticado('post', '/users', driver.token)
      .send({ email: novoEmail(), password: SENHA, fullName: 'X', roleId: roleIdDriver })
      .expect(403);
    await autenticado('get', '/permissions', driver.token).expect(403);
    await autenticado('get', `/users/${driver.id}/permissions`, driver.token).expect(403);
  });

  it('GET /users/:id/permissions com usuário inexistente dá 404', async () => {
    await autenticado(
      'get',
      '/users/00000000-0000-0000-0000-000000000000/permissions',
      tokenAdmin,
    ).expect(404);
  });
});
