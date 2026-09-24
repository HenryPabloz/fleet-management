import { Logger } from '@nestjs/common';
import { OpenAPIObject } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';

type PapelDoBanco = { id: string; name: string; description: string | null };

// Resumo do que cada papel pode fazer (confere com o seed).
const RESUMO_DOS_PAPEIS: Record<string, string> = {
  DRIVER: 'Motorista: cria e vê as próprias viagens, abastecimentos e incidentes.',
  FLEET_MANAGER: 'Gerente: gerencia frota, motoristas, manutenções e vê tudo (sem remoção total).',
  ADMIN: 'Administrador: acesso total, inclusive usuários e deleção permanente.',
};

// As rotas que recebem roleId, com o schema e o corpo de exemplo de cada uma.
const ROTAS_COM_ROLE = [
  { caminho: '/users', metodo: 'post', schema: 'CreateUserDto' },
  { caminho: '/users/{id}/role', metodo: 'patch', schema: 'TrocarRoleDto' },
];

// Regra extra de cada rota, escrita junto da tabela de IDs.
const REGRA_POR_SCHEMA: Record<string, string> = {
  CreateUserDto:
    '\n\n**Quem atribui o quê:** ADMIN atribui qualquer role; quem não é ADMIN (ex: FLEET_MANAGER) só cria `DRIVER` (senão 403). ' +
    'O exemplo `DRIVER` leva o bloco `driver` (obrigatório para essa role); as demais roles não levam `driver` (400 se enviado).',
  TrocarRoleDto:
    '\n\n**Regras:** só ADMIN. Subir exige `USER_ROLE_PROMOTE`, descer exige `USER_ROLE_DEMOTE`. ADMIN não é rebaixado (403). ' +
    'Ao virar `DRIVER` sem perfil de motorista, envie o bloco `driver` (o exemplo `DRIVER` mostra); nas outras roles `driver` não é aceito.',
};

// Sufixo sorteado a cada boot: o e-mail de exemplo nunca colide com uma conta já existente
// (um e-mail fixo como novo.driver@fleet.com dava 409 se alguém já tivesse cadastrado).
const SUFIXO_DO_EXEMPLO = Math.random().toString(36).slice(2, 8);

function montarCorpoDeExemplo(schema: string, roleId: string, nomeDoPapel: string) {
  if (schema === 'CreateUserDto') {
    const corpo: Record<string, unknown> = {
      email: `exemplo.${nomeDoPapel.toLowerCase()}.${SUFIXO_DO_EXEMPLO}@exemplo.com`,
      password: 'SenhaForte123',
      fullName: `Usuário ${nomeDoPapel}`,
      roleId,
      isActive: true,
    };
    // Só o exemplo de DRIVER leva o bloco que cria o perfil de motorista junto.
    if (nomeDoPapel === 'DRIVER') {
      corpo.driver = { licenseNumber: '12345678900', licenseExpiry: '2030-08-30' };
    }
    return corpo;
  }
  if (schema === 'TrocarRoleDto') {
    const corpoTroca: Record<string, unknown> = { roleId };
    if (nomeDoPapel === 'DRIVER') {
      corpoTroca.driver = { licenseNumber: '12345678900', licenseExpiry: '2030-08-30' };
    }
    return corpoTroca;
  }
  return { roleId };
}

function montarTabelaMarkdown(papeis: PapelDoBanco[]): string {
  let tabela = '\n\n**IDs das roles deste ambiente** (os papéis também podem ser listados em `GET /roles`)\n\n| Papel | roleId | O que pode fazer |\n|---|---|---|\n';
  for (const papel of papeis) {
    let resumo = RESUMO_DOS_PAPEIS[papel.name];
    if (!resumo) {
      resumo = papel.description ?? '-';
    }
    tabela += `| ${papel.name} | \`${papel.id}\` | ${resumo} |\n`;
  }
  return tabela;
}

// Lê as roles do banco e escreve os IDs reais no documento Swagger.
// Se falhar, só avisa: a documentação não pode derrubar a aplicação.
export async function enriquecerSwaggerComRoles(
  documento: OpenAPIObject,
  servicoPrisma: PrismaService,
): Promise<void> {
  const logger = new Logger('Swagger');
  try {
    const papeis = await servicoPrisma.role.findMany({
      select: { id: true, name: true, description: true },
    });
    const ordem = ['DRIVER', 'FLEET_MANAGER', 'ADMIN'];
    papeis.sort((a, b) => ordem.indexOf(a.name) - ordem.indexOf(b.name));
    if (papeis.length === 0) {
      logger.warn('Nenhuma role encontrada; Swagger segue sem os IDs.');
      return;
    }

    const tabela = montarTabelaMarkdown(papeis);
    const idDoDriver = papeis.find((papel) => papel.name === 'DRIVER')?.id ?? papeis[0].id;

    for (const rota of ROTAS_COM_ROLE) {
      const operacao = documento.paths?.[rota.caminho]?.[rota.metodo as 'post'];
      if (!operacao) {
        continue;
      }
      operacao.description = (operacao.description ?? '') + tabela + (REGRA_POR_SCHEMA[rota.schema] ?? '');

      const conteudo = (operacao.requestBody as any)?.content?.['application/json'];
      if (conteudo) {
        const exemplos: Record<string, unknown> = {};
        for (const papel of papeis) {
          exemplos[`Usuário ${papel.name}`] = {
            summary: `Usuário ${papel.name}`,
            value: montarCorpoDeExemplo(rota.schema, papel.id, papel.name),
          };
        }
        conteudo.examples = exemplos;
      }
    }

    // Troca o UUID inventado do schema por um ID real (DRIVER, o mais seguro).
    const schemas = documento.components?.schemas as Record<string, any> | undefined;
    for (const nome of ['CreateUserDto', 'TrocarRoleDto']) {
      const propriedade = schemas?.[nome]?.properties?.roleId;
      if (propriedade) {
        propriedade.example = idDoDriver;
      }
    }
  } catch (erro) {
    logger.warn(`Não foi possível ler as roles para o Swagger: ${(erro as Error).message}`);
  }
}
