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
    '\n\n**Regras:** só ADMIN, com `USER_ROLE_PROMOTE`. Só promove (DRIVER < FLEET_MANAGER < ADMIN); papel igual ou menor dá 409 e ADMIN alvo dá 403. ' +
    'Uma promoção errada não pode ser desfeita pela API. O corpo leva só `roleId` (enviar `driver` dá 400).',
};

// Placeholder que nunca existe no banco: o exemplo executado como está não funciona.
const ID_DE_EXEMPLO = '00000000-0000-0000-0000-000000000000';

function montarCorpoDeExemplo(schema: string, nomeDoPapel: string) {
  if (schema === 'CreateUserDto') {
    const corpo: Record<string, unknown> = {
      email: 'pessoa@exemplo.invalid',
      password: 'senha-exemplo',
      fullName: `Usuário ${nomeDoPapel}`,
      roleId: ID_DE_EXEMPLO,
      isActive: true,
    };
    // Só o exemplo de DRIVER leva o bloco que cria o perfil de motorista junto.
    if (nomeDoPapel === 'DRIVER') {
      corpo.driver = { licenseNumber: '00000000000', licenseExpiry: '2020-01-01' };
    }
    return corpo;
  }
  // TrocarRoleDto: só o roleId (a rota apenas promove).
  return { roleId: ID_DE_EXEMPLO };
}

function montarTabelaMarkdown(papeis: PapelDoBanco[]): string {
  let tabela = '\n\n**IDs das roles deste ambiente** (os papéis também podem ser listados em `GET /roles`). Os exemplos usam um ID fictício: copie o `roleId` real da tabela. Exemplo ilustrativo: substitua pelos dados reais antes de executar.\n\n| Papel | roleId | O que pode fazer |\n|---|---|---|\n';
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
          // Promoção nunca tem DRIVER como destino.
          if (rota.schema === 'TrocarRoleDto' && papel.name === 'DRIVER') {
            continue;
          }
          exemplos[`Usuário ${papel.name}`] = {
            summary: `Usuário ${papel.name}`,
            value: montarCorpoDeExemplo(rota.schema, papel.name),
          };
        }
        conteudo.examples = exemplos;
      }
    }

  } catch (erro) {
    logger.warn(`Não foi possível ler as roles para o Swagger: ${(erro as Error).message}`);
  }
}
