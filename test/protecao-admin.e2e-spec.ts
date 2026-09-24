import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/database/prisma.service';
import { criarUsuarioELogar, UsuarioCriado } from './helpers/usuarios-e2e';

jest.setTimeout(120000);

// Regra: não-ADMIN nunca mexe em ADMIN; ADMIN não desativa/apaga outro ADMIN nem a si mesmo.
describe('Proteção de contas ADMIN (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenAdmin: string;
  const idsUsuarios: string[] = [];

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
      'e2e-protadmin',
      `Teste Protecao ${nomeDoPapel}`,
    );
    idsUsuarios.push(usuario.id);
    return usuario;
  }

  // Gerente com as três permissions de usuário delegadas.
  async function novoGerenteComPermissoes(): Promise<UsuarioCriado> {
    const gerente = await novoUsuario('FLEET_MANAGER');
    for (const codigo of ['USER_UPDATE', 'USER_DELETE', 'USER_RESTORE']) {
      await autenticado(tokenAdmin, 'post', `/users/${gerente.id}/permissions`).send({
        permissionCode: codigo,
      });
    }
    return gerente;
  }

  async function estadoDoUsuario(id: string) {
    const linhas = await prisma.$queryRaw<
      Array<{ is_active: boolean; deleted_at: Date | null }>
    >`SELECT is_active, deleted_at FROM users WHERE id_user = ${id}::uuid`;
    return linhas[0];
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
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.userPermission.deleteMany({ where: { userId: { in: idsUsuarios } } });
      await prisma.driver.deleteMany({ where: { userId: { in: idsUsuarios } } });
      await prisma.user.deleteMany({ where: { id: { in: idsUsuarios } } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('Gerente com permission delegada contra conta ADMIN: 403', () => {
    it('PATCH, PUT, DELETE e restore devolvem 403 e o ADMIN continua ativo', async () => {
      const gerente = await novoGerenteComPermissoes();
      const admin = await novoUsuario('ADMIN');

      await autenticado(gerente.token, 'patch', `/users/${admin.id}`)
        .send({ isActive: false })
        .expect(403);
      await autenticado(gerente.token, 'patch', `/users/${admin.id}`)
        .send({ fullName: 'Nome Novo' })
        .expect(403);
      await autenticado(gerente.token, 'put', `/users/${admin.id}`)
        .send({ fullName: 'Nome Novo', isActive: false })
        .expect(403);
      await autenticado(gerente.token, 'delete', `/users/${admin.id}`).expect(403);
      await autenticado(gerente.token, 'patch', `/users/${admin.id}/restore`).expect(403);

      const estado = await estadoDoUsuario(admin.id);
      expect(estado.is_active).toBe(true);
      expect(estado.deleted_at).toBeNull();
    });

    it('restore de ADMIN já removido também dá 403 para o gerente', async () => {
      const gerente = await novoGerenteComPermissoes();
      const admin = await novoUsuario('ADMIN');
      await prisma.$executeRaw`UPDATE users SET deleted_at = now() WHERE id_user = ${admin.id}::uuid`;

      await autenticado(gerente.token, 'patch', `/users/${admin.id}/restore`).expect(403);
      const estado = await estadoDoUsuario(admin.id);
      expect(estado.deleted_at).not.toBeNull();
    });

    it('alvo não-ADMIN segue funcionando com a permission delegada', async () => {
      const gerente = await novoGerenteComPermissoes();
      const alvo = await novoUsuario('DRIVER');

      await autenticado(gerente.token, 'patch', `/users/${alvo.id}`)
        .send({ fullName: 'Motorista Editado' })
        .expect(200);
      await autenticado(gerente.token, 'put', `/users/${alvo.id}`)
        .send({ fullName: 'Motorista Editado', isActive: false })
        .expect(200);
      await autenticado(gerente.token, 'delete', `/users/${alvo.id}`).expect(204);
      await autenticado(gerente.token, 'patch', `/users/${alvo.id}/restore`).expect(200);
    });
  });

  describe('ADMIN contra outro ADMIN', () => {
    it('desativar (PATCH e PUT), soft delete e hard delete dão 403', async () => {
      const outroAdmin = await novoUsuario('ADMIN');

      await autenticado(tokenAdmin, 'patch', `/users/${outroAdmin.id}`)
        .send({ isActive: false })
        .expect(403);
      await autenticado(tokenAdmin, 'put', `/users/${outroAdmin.id}`)
        .send({ fullName: 'Admin Teste', isActive: false })
        .expect(403);
      await autenticado(tokenAdmin, 'delete', `/users/${outroAdmin.id}`).expect(403);
      await autenticado(tokenAdmin, 'delete', `/users/${outroAdmin.id}/permanent`).expect(403);

      const estado = await estadoDoUsuario(outroAdmin.id);
      expect(estado.is_active).toBe(true);
      expect(estado.deleted_at).toBeNull();
    });

    it('editar fullName, reativar e restaurar continuam permitidos (200)', async () => {
      const outroAdmin = await novoUsuario('ADMIN');

      const edicao = await autenticado(tokenAdmin, 'patch', `/users/${outroAdmin.id}`)
        .send({ fullName: 'Admin Renomeado' })
        .expect(200);
      expect(edicao.body.fullName).toBe('Admin Renomeado');

      await autenticado(tokenAdmin, 'patch', `/users/${outroAdmin.id}`)
        .send({ isActive: true })
        .expect(200);

      await prisma.$executeRaw`UPDATE users SET deleted_at = now() WHERE id_user = ${outroAdmin.id}::uuid`;
      await autenticado(tokenAdmin, 'patch', `/users/${outroAdmin.id}/restore`).expect(200);
      const estado = await estadoDoUsuario(outroAdmin.id);
      expect(estado.deleted_at).toBeNull();
    });
  });

  describe('ADMIN contra a própria conta: 409', () => {
    it('desativar, soft delete e hard delete de si mesmo dão 409 e a conta segue ativa', async () => {
      const admin = await novoUsuario('ADMIN');

      await autenticado(admin.token, 'patch', `/users/${admin.id}`)
        .send({ isActive: false })
        .expect(409);
      await autenticado(admin.token, 'put', `/users/${admin.id}`)
        .send({ fullName: 'Admin Teste', isActive: false })
        .expect(409);
      await autenticado(admin.token, 'delete', `/users/${admin.id}`).expect(409);
      await autenticado(admin.token, 'delete', `/users/${admin.id}/permanent`).expect(409);

      const estado = await estadoDoUsuario(admin.id);
      expect(estado.is_active).toBe(true);
      expect(estado.deleted_at).toBeNull();
    });
  });
});
