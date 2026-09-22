import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';

// Códigos de permissão e nomes de papel seguem o guia (ficam em inglês).
const permissoes = [
  // Trip
  { code: 'TRIP_CREATE', description: 'Create trip' },
  { code: 'TRIP_VIEW_OWN', description: 'View own trips' },
  { code: 'TRIP_VIEW_ALL', description: 'View all trips' },
  { code: 'TRIP_CANCEL_OWN', description: 'Cancel own trip' },

  // Refueling
  { code: 'REFUELING_CREATE', description: 'Create refueling' },
  { code: 'REFUELING_VIEW_OWN', description: 'View own refuelings' },
  { code: 'REFUELING_VIEW_ALL', description: 'View all refuelings' },

  // Incident
  { code: 'INCIDENT_CREATE', description: 'Create incident' },
  { code: 'INCIDENT_VIEW_OWN', description: 'View own incidents' },
  { code: 'INCIDENT_VIEW_ALL', description: 'View all incidents' },

  // Driver
  { code: 'DRIVER_VIEW', description: 'View drivers' },
  { code: 'DRIVER_CREATE', description: 'Create driver' },
  { code: 'DRIVER_UPDATE', description: 'Update driver' },

  // Vehicle
  { code: 'VEHICLE_VIEW', description: 'View vehicles' },
  { code: 'VEHICLE_CREATE', description: 'Create vehicle' },
  { code: 'VEHICLE_UPDATE', description: 'Update vehicle' },

  // Maintenance
  { code: 'MAINTENANCE_VIEW_ALL', description: 'View all maintenance' },
  { code: 'MAINTENANCE_CREATE', description: 'Create maintenance' },
  { code: 'MAINTENANCE_UPDATE', description: 'Update maintenance' },

  // Analytics
  { code: 'ANALYTICS_VIEW', description: 'View analytics' },

  // Profile
  { code: 'PROFILE_VIEW', description: 'View own profile' },
  { code: 'PROFILE_UPDATE_OWN', description: 'Update own profile' },
  { code: 'PASSWORD_CHANGE_OWN', description: 'Change own password' },

  // User, role, permission and audit (admin)
  { code: 'USER_CREATE', description: 'Create user' },
  { code: 'USER_UPDATE', description: 'Update user' },
  { code: 'USER_DELETE', description: 'Delete user' },
  { code: 'ROLE_MANAGE', description: 'Manage roles' },
  { code: 'PERMISSION_MANAGE', description: 'Manage permissions' },
  { code: 'AUDIT_VIEW', description: 'View audit logs' },
];

// Códigos do seed antigo que não existem mais no DESIGN: o seed apaga só estes.
const permissoesObsoletas = [
  'TRIP_UPDATE',
  'INCIDENT_UPDATE',
  'MAINTENANCE_VIEW',
  'TRIP_CANCEL',
];

const papeis = [
  { name: 'DRIVER', description: 'Fleet driver' },
  { name: 'FLEET_MANAGER', description: 'Fleet manager' },
  { name: 'ADMIN', description: 'Administrator' },
];

// Matriz da seção 7.2 do DESIGN.
const codigosMotorista = [
  'TRIP_CREATE',
  'TRIP_VIEW_OWN',
  'TRIP_CANCEL_OWN',
  'REFUELING_CREATE',
  'REFUELING_VIEW_OWN',
  'INCIDENT_CREATE',
  'INCIDENT_VIEW_OWN',
  'PROFILE_VIEW',
  'PROFILE_UPDATE_OWN',
  'PASSWORD_CHANGE_OWN',
];

// O gerente tem tudo do motorista mais estes.
const codigosExtrasGerente = [
  'DRIVER_VIEW',
  'DRIVER_CREATE',
  'DRIVER_UPDATE',
  'VEHICLE_VIEW',
  'VEHICLE_CREATE',
  'VEHICLE_UPDATE',
  'TRIP_VIEW_ALL',
  'REFUELING_VIEW_ALL',
  'INCIDENT_VIEW_ALL',
  'MAINTENANCE_VIEW_ALL',
  'MAINTENANCE_CREATE',
  'MAINTENANCE_UPDATE',
  'ANALYTICS_VIEW',
];

function montarPermissoesPorPapel() {
  const codigosGerente: string[] = [];
  for (const codigo of codigosMotorista) {
    codigosGerente.push(codigo);
  }
  for (const codigo of codigosExtrasGerente) {
    codigosGerente.push(codigo);
  }

  // O admin recebe TODAS as permissões da lista acima.
  const codigosAdmin: string[] = [];
  for (const permissao of permissoes) {
    codigosAdmin.push(permissao.code);
  }

  return [
    { papel: 'DRIVER', codigos: codigosMotorista },
    { papel: 'FLEET_MANAGER', codigos: codigosGerente },
    { papel: 'ADMIN', codigos: codigosAdmin },
  ];
}

// Valores padrão do guia: só valem fora de produção.
const EMAIL_ADMIN_PADRAO = 'admin@fleet.com';
const SENHA_ADMIN_PADRAO = 'Admin@123';

function criarPrisma(): PrismaClient {
  const urlBanco = process.env.DATABASE_URL;
  if (!urlBanco) {
    throw new Error('DATABASE_URL is not set (check your .env file)');
  }

  const adaptador = new PrismaPg({ connectionString: urlBanco });
  return new PrismaClient({ adapter: adaptador });
}

// Devolve o e-mail em minúsculas (o banco só aceita assim).
// Em produção o e-mail é obrigatório; fora dela usa o padrão do guia.
function lerEmailAdmin(): string {
  let email = process.env.ADMIN_EMAIL;
  if (!email || email.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ADMIN_EMAIL is required when NODE_ENV=production');
    }
    email = EMAIL_ADMIN_PADRAO;
  }
  return email.trim().toLowerCase();
}

// Em produção a senha é obrigatória; fora dela usa o padrão do guia.
function lerSenhaAdmin(): string {
  const senha = process.env.ADMIN_INITIAL_PASSWORD;
  if (senha && senha !== '') {
    return senha;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_INITIAL_PASSWORD is required when NODE_ENV=production');
  }
  return SENHA_ADMIN_PADRAO;
}

// Lê a chave de API do admin (64 hex minúsculos) e diz se foi gerada agora.
// Em produção ela é obrigatória; fora dela, se faltar, gera uma nova.
function lerChaveApiAdmin(): { chave: string; foiGerada: boolean } {
  const chaveDoEnv = process.env.ADMIN_API_KEY;

  if (chaveDoEnv && chaveDoEnv !== '') {
    if (!/^[0-9a-f]{64}$/.test(chaveDoEnv)) {
      throw new Error('ADMIN_API_KEY must be exactly 64 lowercase hex characters');
    }
    return { chave: chaveDoEnv, foiGerada: false };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_API_KEY is required when NODE_ENV=production');
  }
  return { chave: randomBytes(32).toString('hex'), foiGerada: true };
}

// O banco guarda só o hash SHA-256 da chave, nunca a chave.
function gerarHashDaChave(chave: string): string {
  return createHash('sha256').update(chave).digest('hex');
}

async function criarPermissoes(clientePrisma: PrismaClient) {
  for (const permissao of permissoes) {
    await clientePrisma.permission.upsert({
      where: { code: permissao.code },
      update: { description: permissao.description },
      create: permissao,
    });
  }
  console.log(`Seeded ${permissoes.length} permissions`);
}

async function criarPapeis(clientePrisma: PrismaClient) {
  for (const papel of papeis) {
    await clientePrisma.role.upsert({
      where: { name: papel.name },
      update: { description: papel.description },
      create: papel,
    });
  }
  console.log(`Seeded ${papeis.length} roles`);
}

// Apaga só as permissões obsoletas (os vínculos saem junto, por cascade).
async function removerPermissoesObsoletas(clientePrisma: PrismaClient) {
  for (const codigo of permissoesObsoletas) {
    await clientePrisma.permission.deleteMany({ where: { code: codigo } });
  }
  console.log(`Removed obsolete permissions (if any): ${permissoesObsoletas.length} codes checked`);
}

async function ligarPermissoesAosPapeis(clientePrisma: PrismaClient) {
  const permissoesPorPapel = montarPermissoesPorPapel();
  for (const item of permissoesPorPapel) {
    const papel = await clientePrisma.role.findUnique({ where: { name: item.papel } });
    if (!papel) {
      throw new Error(`Role ${item.papel} not found`);
    }

    for (const codigo of item.codigos) {
      const permissao = await clientePrisma.permission.findUnique({ where: { code: codigo } });
      if (!permissao) {
        throw new Error(`Permission ${codigo} not found`);
      }

      await clientePrisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: papel.id, permissionId: permissao.id },
        },
        update: {},
        create: { roleId: papel.id, permissionId: permissao.id },
      });
    }
  }
  console.log('Assigned permissions to roles');
}

async function criarAdmin(
  clientePrisma: PrismaClient,
  email: string,
  senha: string,
  chaveApi: { chave: string; foiGerada: boolean },
) {
  const papelAdmin = await clientePrisma.role.findUnique({ where: { name: 'ADMIN' } });
  if (!papelAdmin) {
    throw new Error('Role ADMIN not found');
  }

  const senhaComHash = bcrypt.hashSync(senha, 10);

  // update vazio: numa segunda execução não troca a senha do admin.
  const admin = await clientePrisma.user.upsert({
    where: { email: email },
    update: {},
    create: {
      email: email,
      password: senhaComHash,
      fullName: 'Admin User',
      roleId: papelAdmin.id,
      isActive: true,
    },
  });
  console.log(`Admin user ready (${email})`);

  // Só grava a chave se o admin ainda não tiver uma (nunca sobrescreve).
  const resultado = await clientePrisma.user.updateMany({
    where: { id: admin.id, apiKey: null },
    data: { apiKey: gerarHashDaChave(chaveApi.chave), apiKeyCreatedAt: new Date() },
  });

  if (resultado.count === 0) {
    console.log('Admin already has an API key (kept as is)');
    return;
  }

  console.log('Admin API key saved (hash only)');
  if (chaveApi.foiGerada) {
    console.log(`ADMIN API KEY: ${chaveApi.chave}`);
    console.log('Save it now, it will not be shown again.');
  }
}

async function main() {
  console.log('Starting seed...');

  // Lê as configurações antes de gravar qualquer coisa (falha cedo).
  const emailAdmin = lerEmailAdmin();
  const senhaAdmin = lerSenhaAdmin();
  const chaveApiAdmin = lerChaveApiAdmin();
  const clientePrisma = criarPrisma();

  try {
    await criarPermissoes(clientePrisma);
    await criarPapeis(clientePrisma);
    await removerPermissoesObsoletas(clientePrisma);
    await ligarPermissoesAosPapeis(clientePrisma);
    await criarAdmin(clientePrisma, emailAdmin, senhaAdmin, chaveApiAdmin);
    console.log('Seed completed successfully');
  } finally {
    await clientePrisma.$disconnect();
  }
}

main().catch((erro) => {
  // Mostra só a mensagem quando for um Error (sem stack e sem segredos).
  let mensagem = erro;
  if (erro instanceof Error) {
    mensagem = erro.message;
  }
  console.error('Seed failed:', mensagem);
  process.exit(1);
});
