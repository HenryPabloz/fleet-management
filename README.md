# API de Gestão de Frota Corporativa

API REST em NestJS para gestão de veículos, motoristas, viagens, abastecimentos, manutenções e incidentes de uma frota corporativa, com indicadores (analytics) e auditoria.

## Sumário

- [Principais capacidades](#principais-capacidades)
- [Stack e versões](#stack-e-versões)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração (.env)](#configuração-env)
- [Execução](#execução)
- [Seed](#seed)
- [Testes](#testes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Autenticação](#autenticação)
- [Endpoints](#endpoints)
- [Exclusão: soft delete e deleção total](#exclusão-soft-delete-e-deleção-total)
- [Exemplos de uso (curl)](#exemplos-de-uso-curl)
- [Formato de erro](#formato-de-erro)
- [Swagger](#swagger)
- [Banco de dados](#banco-de-dados)

## Principais capacidades

- **Autenticação em duas camadas**: não existe cadastro público. Quem tem `USER_CREATE` (ADMIN e FLEET_MANAGER) cria o usuário em `POST /users`, recebe a API key uma única vez e a entrega ao usuário → login com e-mail + senha + API key → JWT para as rotas de negócio.
- **RBAC** com 3 papéis (`DRIVER`, `FLEET_MANAGER`, `ADMIN`) e 44 permissões, aplicadas via guards nas rotas, com delegação pontual por usuário (`UserPermission`).
- **Troca de papel controlada**: `PATCH /users/:id/role` (ADMIN + `USER_ROLE_PROMOTE`) só sobe de papel, com ranking DRIVER < FLEET_MANAGER < ADMIN (não existe rebaixar pela API).
- **Soft delete** em 7 models (users, drivers, vehicles, trips, refuelings, maintenances, incidents), com soft delete/`restore` delegáveis por permission (`<RECURSO>_DELETE`/`<RECURSO>_RESTORE`) e exclusão permanente (deleção total) separada e exclusiva do `ADMIN` por papel.
- **Regras de negócio no banco**: procedures e triggers em PostgreSQL garantem integridade (ex: não permitir duas viagens ativas para o mesmo veículo/motorista, sincronizar quilometragem, auditoria append-only, com autor anonimizável).
- **Integração com ViaCEP** (via `HttpService`) para validar/enriquecer o CEP da localização inicial de um veículo.
- **Analytics/indicadores de frota**: consumo de combustível, distância diária, eficiência por veículo, viagens por motorista, incidentes por severidade.
- **Upload local de arquivos**: foto opcional em incidentes, servida em `/uploads/*`.

## Stack e versões

Versões efetivamente instaladas (resolvidas em `package-lock.json`), não os ranges do `package.json`.

**Runtime/infra:**

| Item | Versão |
|---|---|
| Node.js | v24.16.0 |
| Docker | 29.8.0 |
| PostgreSQL | 15.19 (imagem `postgres:15-alpine`, via Docker Compose) |
| TypeScript | 5.9.3 |

**Dependências principais (produção):**

| Pacote | Versão instalada |
|---|---|
| @nestjs/common / @nestjs/core / @nestjs/platform-express | 11.2.5 |
| @nestjs/config | 12.0.0 |
| @nestjs/jwt | 12.0.2 |
| @nestjs/passport | 12.0.0 |
| @nestjs/swagger | 11.4.7 |
| @nestjs/throttler | 6.7.0 |
| @nestjs/axios | 12.0.1 |
| @prisma/client / @prisma/adapter-pg / prisma (CLI) | 7.10.0 |
| bcrypt | 6.0.0 |
| class-validator | 0.15.1 |
| class-transformer | 0.5.1 |
| helmet | 8.3.0 |
| joi | 18.2.9 |
| multer | 2.4.0 |
| passport | 0.7.0 |
| passport-jwt | 4.0.1 |
| pg | 8.23.0 |
| rxjs | 7.8.2 |

**Dev/testes:**

| Pacote | Versão instalada |
|---|---|
| jest | 30.5.2 |
| ts-jest | 29.4.12 |
| ts-node | 10.9.2 |
| supertest | 7.2.2 |
| eslint | 9.39.5 |
| prettier | 3.9.8 |

## Pré-requisitos

- [Docker](https://www.docker.com/) (para o PostgreSQL via Docker Compose)
- Node.js 24 ou superior
- npm

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Subir o PostgreSQL (Docker Compose)
docker compose up -d

# 3. Aplicar as migrations
npx prisma migrate deploy
```

### Rodando com Docker (app + banco)

Além do PostgreSQL, a própria API também pode subir em container (serviço `app` no `docker-compose.yml`, imagem construída pelo `Dockerfile` multi-stage da raiz):

```bash
# sobe Postgres + API, construindo a imagem da API se necessário
docker compose up -d --build
```

O que acontece automaticamente:

- O serviço `app` só inicia depois que o `postgres` fica `healthy` (`depends_on` com `condition: service_healthy`).
- No start do container, o `CMD` do `Dockerfile` roda `npx prisma migrate deploy` antes de subir a aplicação — não é preciso aplicar as migrations manualmente.
- O `Dockerfile` usa `COPY --chown` (sem `chown -R` em camada separada): build de ~4 min para ~1 min e imagem de 1.86 GB para 1.05 GB.
- A pasta `uploads/` (fotos de incidentes) fica num volume Docker (`uploads_data`), então os arquivos sobrevivem a um rebuild do container.

**Atenção à porta do banco:** fora do container (no seu PC) o Postgres está em `localhost:5433` (é o mapeamento definido no serviço `postgres`). Dentro da rede interna do compose, o serviço `app` enxerga o Postgres como `postgres:5432` (nome do serviço, porta interna padrão) — por isso o `DATABASE_URL` usado pelo container da API é diferente do valor em `.env.example`/`.env` (que é pensado pra rodar a API fora do Docker, contra a porta `5433` do host).

Para derrubar sem apagar o volume do banco:

```bash
docker compose down
```

## Configuração (.env)

Copie `.env.example` para `.env` e preencha os valores. Nenhum valor abaixo é real, são apenas exemplos de formato.

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | String de conexão do PostgreSQL (formato `postgresql://usuario:senha@host:porta/banco?schema=public`). |
| `JWT_SECRET` | Chave usada para assinar e validar os tokens JWT. |
| `JWT_EXPIRATION` | Prazo de validade do JWT (ex: `24h`). |
| `PORT` | Porta em que a aplicação escuta (padrão `3000`). |
| `NODE_ENV` | Ambiente de execução (`development`, `production`, `test`). |
| `AWS_ACCESS_KEY_ID` | Credencial de acesso à AWS (reservada para uso incremental; não é usada no upload local atual). |
| `AWS_SECRET_ACCESS_KEY` | Segredo correspondente à credencial AWS acima. |
| `AWS_REGION` | Região da AWS associada às credenciais acima. |
| `AWS_S3_BUCKET` | Nome do bucket S3 associado às credenciais acima. |
| `CEP_API_URL` | URL base da API do ViaCEP usada para validar/enriquecer CEPs. |
| `CEP_TIMEOUT_MS` | Timeout (em ms) das chamadas à API de CEP. |
| `CORS_ORIGIN` | Origens liberadas para CORS. `*` libera qualquer origem (uso em dev); em produção, use uma lista de domínios separados por vírgula (ex: `https://app.com,https://admin.app.com`) — com origem restrita, `credentials: true` é habilitado junto. |
| `ADMIN_EMAIL` | E-mail do usuário admin criado pelo seed. |
| `ADMIN_INITIAL_PASSWORD` | Senha inicial do usuário admin criado pelo seed. |
| `ADMIN_API_KEY` | API key do admin (64 caracteres hex minúsculos, ex: gerada com `openssl rand -hex 32`); se vazia fora de produção, o seed gera uma e imprime no console. |

## Execução

```bash
# desenvolvimento (watch mode)
npm run start:dev

# build de produção
npm run build

# produção (após o build)
npm run start:prod
```

## Seed

```bash
npm run seed
```

O seed é idempotente e cria/atualiza:

- **43 permissions** (uma por ação, ex: `TRIP_CREATE`, `VEHICLE_UPDATE`, `USER_VIEW`, `AUDIT_VIEW`).
- **3 roles**: `DRIVER`, `FLEET_MANAGER`, `ADMIN`.
- **82 vínculos** role↔permission (10 para `DRIVER`, 29 para `FLEET_MANAGER`, 43 para `ADMIN`, que recebe todas).
- **1 usuário admin**, com API key gerada (ou lida de `ADMIN_API_KEY`) e impressa uma única vez no console fora de produção.

## Testes

```bash
# testes unitários
npm test

# testes end-to-end (sobem a aplicação real contra o banco configurado em DATABASE_URL)
npm run test:e2e
```

No estado atual do repositório: `npm test` roda **3 suítes / 8 testes** (`app.controller.spec.ts`, `via-cep.service.spec.ts`, `trips.service.spec.ts`), e `npm run test:e2e` roda **16 suítes / 276 testes** (`analytics`, `app`, `auth-api-key`, `hard-delete-admin`, `hard-delete-dependencias`, `permissions-delegation`, `protecao-admin`, `roles`, `seguranca-r4`, `soft-delete-permissions`, `soft-delete`, `trips-refuelings-incidents`, `users-criacao-troca-role`, `users-me-audit-logs`, `users-motorista-reemissao`, `vehicles-maintenances`), cobrindo auth, RBAC, delegação granular de permissão (`UserPermission`), criação de usuário/motorista e troca de role, reemissão de API key, CRUD dos 7 recursos principais, soft delete/restore por permission, procedures/triggers, integração com ViaCEP, escopo do motorista (registro alheio: 404; `driverId` alheio: 403), proteção de contas ADMIN, perfil próprio (`/users/me`) e auditoria (`/audit-logs`).

**Atenção:** os e2e chamam a API pública real do ViaCEP (sem mock), que oscila. Para mitigar, os specs `trips-refuelings-incidents` e `vehicles-maintenances` usam `jest.retryTimes(2)` (até 2 retentativas por teste). Se ainda assim um teste isolado falhar por causa do ViaCEP, rode `npm run test:e2e` de novo antes de investigar. O teste de analytics não depende de totais globais, porque as suítes rodam em paralelo no mesmo banco.

## Estrutura do projeto

```
src/
├── auth/          # Login (e-mail+senha+API key), renovação de chave/JWT, guards, decorators
├── users/         # Criação de usuário (gera a API key; com CNH cria o motorista junto), troca de role, reemissão de chave, CRUD e perfil próprio
├── drivers/       # Leitura, atualização e exclusão de motoristas (o cadastro é feito em POST /users)
├── vehicles/      # CRUD de veículos (com validação de CEP via ViaCEP)
├── trips/         # Ciclo de viagens: criar, iniciar, encerrar, cancelar
├── refuelings/    # Registro de abastecimentos (via procedure, sincroniza km do veículo)
├── maintenances/  # Registro e acompanhamento de manutenções
├── incidents/     # Registro de incidentes, com upload opcional de foto
├── analytics/     # Indicadores de frota (consumo, distância, eficiência, incidentes)
├── permissions/   # Delegação granular de permissões (UserPermission), ADMIN-only
├── roles/         # Listagem dos papéis (GET /roles), para o select de roleId
├── external/
│   └── viacep/    # Cliente HTTP para a API pública do ViaCEP
├── common/        # DTOs, interceptors, pipes, validators, utils e schemas compartilhados
├── database/      # Módulo/serviço do Prisma (conexão com o PostgreSQL)
├── config/        # Validação e leitura da configuração (variáveis de ambiente)
└── generated/     # Prisma Client gerado (não editar manualmente)
```

Cada módulo de recurso (`drivers`, `vehicles`, `trips`, `refuelings`, `maintenances`, `incidents`, `users`, `permissions`, `roles`) segue o mesmo padrão: `*.controller.ts`, `*.service.ts`, `*.module.ts` e uma pasta `dto/`.

## Autenticação

Fluxo real, em duas camadas. **Não existe cadastro público**: toda conta nasce em `POST /users`.

1. **Cadastro** (`POST /users`, JWT + permission `USER_CREATE`): um ADMIN ou FLEET_MANAGER cria o usuário. O servidor gera a API key, grava só o hash SHA-256 e devolve a chave em texto (`apiKey`) **uma única vez** (`Cache-Control: no-store`); ela nunca fica nula e não aparece de novo. Quem cadastrou entrega a chave ao usuário.
   - ADMIN atribui qualquer papel. FLEET_MANAGER (ou quem tiver `USER_CREATE` delegado e não for ADMIN) só cria `DRIVER`; outro papel retorna `403`.
   - Papel `DRIVER` exige o bloco `driver { licenseNumber, licenseExpiry }` (CNH com 11 dígitos numéricos): conta e perfil de motorista nascem na mesma transação. `driver` com outro papel retorna `400`. (`POST /drivers` não existe mais.)
2. **Login** (`POST /auth/login`): e-mail + senha no corpo **e** a API key no header `x-api-key`. Devolve `{ accessToken, user }`; dentro de `user` vêm `id`, `email`, `fullName`, `role`, `permissions: string[]` (permissions efetivas = papel + delegadas) e `driverId: string | null` (perfil Driver ativo). `POST /auth/refresh-token` e `GET /users/me` devolvem os mesmos dois campos (`permissions` e `driverId`).
3. **Rotas de negócio**: exigem o JWT no header `Authorization: Bearer <token>`. Cada rota é restrita por papel fixo (`@Roles(...)`) ou por permissão delegável (`@Permissions(...)`), ambos avaliados pelo `RolesGuard` — ver [seção Endpoints](#endpoints) e `projectDocs/projeto-fleet-management.md` (seção 5) para o detalhe de qual mecanismo cada rota usa.
4. **Renovação**: `POST /auth/refresh-token` troca o JWT (autenticado por Bearer; o front chama antes de expirar). `PATCH /auth/regenerate-key` troca a própria API key: exige a chave atual no header `x-api-key` **e** a `password` no corpo (`400` sem ela, `401` com senha errada); o JWT em uso continua válido e a chave só é usada no login. São rotas e credenciais diferentes, não confundir.
5. **Chave perdida**: `POST /users/:id/regenerate-api-key` (somente ADMIN, não delegável) reemite a chave de outro usuário, devolvendo a nova uma única vez.
6. **Troca de papel**: `PATCH /users/:id/role` com `{ roleId, driver? }` (regras na seção Users, abaixo). Vale imediatamente, inclusive para o JWT já emitido (o papel é lido do banco a cada requisição).

**Nota operacional:** existem 3 usuários antigos, criados pelo `POST /users` da versão anterior, que ficaram sem API key. Para eles, um ADMIN deve reemitir a chave com `POST /users/:id/regenerate-api-key` e entregá-la ao dono.

Para o detalhe completo (guards, estratégias, matriz de permissões, RBAC) veja `../markdown/SEGURANCA-E-AUTENTICACAO.md` (fora da pasta `fleet-management/`, em `avaliacaoBackEnd/markdown/`).

## Endpoints

Autenticação: **pública** (sem guard), **API key** (header `x-api-key`) ou **JWT** (header `Authorization: Bearer`, + papéis exigidos). Documentação interativa completa, com request/response de cada rota, em `/api/docs` (Swagger) — ver [seção Swagger](#swagger).

### Health (`/health`)

| Método | Rota | Autenticação |
|---|---|---|
| GET | `/health` | Pública (sem autenticação, fora do rate limiting) |

### Auth (`/auth`)

| Método | Rota | Autenticação |
|---|---|---|
| POST | `/auth/login` | API key (`x-api-key`) |
| PATCH | `/auth/regenerate-key` | API key atual (`x-api-key`) + `password` no corpo |
| POST | `/auth/refresh-token` | JWT |

### Users (`/users`)

| Método | Rota | Acesso |
|---|---|---|
| GET | `/users` | Permission `USER_VIEW` (ADMIN por papel; gerente só por delegação) |
| GET | `/users/deleted/all` | Permission `USER_RESTORE` (ADMIN por papel) |
| GET | `/users/me` | Todos os papéis (permission `PROFILE_VIEW`) |
| PATCH | `/users/me` | Todos os papéis (permission `PROFILE_UPDATE_OWN`) |
| PATCH | `/users/me/password` | Todos os papéis (permission `PASSWORD_CHANGE_OWN`) |
| GET | `/users/:id` | Permission `USER_VIEW` (ADMIN por papel; gerente só por delegação) |
| POST | `/users` | Permission `USER_CREATE` (ADMIN e FLEET_MANAGER; gerente só cria `DRIVER`). Devolve `apiKey` uma vez |
| PATCH | `/users/:id/role` | `@Roles('ADMIN')` + `USER_ROLE_PROMOTE` (só promove, sem rota de rebaixar) |
| POST | `/users/:id/regenerate-api-key` | Somente ADMIN (`@Roles('ADMIN')`, não delegável) |
| PATCH | `/users/:id` | Permission `USER_UPDATE` (ADMIN por papel). Aceita só `fullName` e `isActive` |
| DELETE | `/users/:id` | Permission `USER_DELETE` (ADMIN por papel) |
| PATCH | `/users/:id/restore` | Permission `USER_RESTORE` (ADMIN por papel) |
| DELETE | `/users/:id/permanent` | Somente ADMIN (`@Roles('ADMIN')`) |

Regras de `PATCH /users/:id/role` (body `{ roleId }`, só promoção): ranking `DRIVER < FLEET_MANAGER < ADMIN`; permitido só subir (`DRIVER→FLEET_MANAGER`, `DRIVER→ADMIN`, `FLEET_MANAGER→ADMIN`); a mesma role ou uma role igual/menor que a atual dá `409` (rebaixar não é suportado); alvo ADMIN dá `403`; ninguém muda a própria role (`409`); `roleId` inexistente `400`; alvo inexistente ou soft-deletado `404`; enviar `driver` no corpo não é mais aceito (`400`).

`roleId` **não é aceito** em `PATCH /users/:id` (`400` se enviado): a role só muda por `PATCH /users/:id/role`. Não existe `PUT` em nenhum recurso da API.

**Proteção de contas ADMIN** (editar, desativar, soft delete, restore e deleção total de usuário):

- Quem não é ADMIN (mesmo com `USER_UPDATE`/`USER_DELETE`/`USER_RESTORE` delegados) recebe `403` ("Only an ADMIN can modify another ADMIN account") ao mexer numa conta ADMIN.
- Um ADMIN não pode desativar (`isActive=false`), soft-deletar nem apagar de vez **outro** ADMIN (`403`), nem a própria conta (`409`, "You cannot deactivate or delete your own account").
- ADMIN pode editar o `fullName` de outro ADMIN, reativar e restaurar. Alvos não-ADMIN: comportamento normal.

### Drivers (`/drivers`)

Não há `POST /drivers`: o motorista nasce junto com o usuário, em `POST /users` com papel `DRIVER` e bloco `driver`.

| Método | Rota | Acesso |
|---|---|---|
| GET | `/drivers` | Permission `DRIVER_VIEW` (ADMIN, FLEET_MANAGER) |
| GET | `/drivers/deleted/all` | Permission `DRIVER_RESTORE` (ADMIN por padrão) |
| GET | `/drivers/:id` | Permission `DRIVER_VIEW` (ADMIN, FLEET_MANAGER) |
| PATCH | `/drivers/:id` | Permission `DRIVER_UPDATE` (ADMIN, FLEET_MANAGER). Aceita só `licenseExpiry` |
| DELETE | `/drivers/:id` | Permission `DRIVER_DELETE` (ADMIN por padrão) |
| PATCH | `/drivers/:id/restore` | Permission `DRIVER_RESTORE` (ADMIN por padrão) |
| DELETE | `/drivers/:id/permanent` | Somente ADMIN (`@Roles('ADMIN')`) |

### Vehicles (`/vehicles`)

| Método | Rota | Acesso |
|---|---|---|
| GET | `/vehicles` | ADMIN, FLEET_MANAGER, DRIVER (total, todos os status) |
| GET | `/vehicles/in-use` | ADMIN, FLEET_MANAGER, DRIVER (status `IN_USE`; inclui veículo com viagem só planejada, pois `create_trip` já marca `IN_USE`) |
| GET | `/vehicles/not-in-use` | ADMIN, FLEET_MANAGER, DRIVER (demais status; aceita filtro `status` exceto `IN_USE`) |
| GET | `/vehicles/deleted/all` | Permission `VEHICLE_RESTORE` (ADMIN, FLEET_MANAGER) |
| GET | `/vehicles/:id` | ADMIN, FLEET_MANAGER, DRIVER |
| POST | `/vehicles` | ADMIN, FLEET_MANAGER |
| PATCH | `/vehicles/:id` | ADMIN, FLEET_MANAGER |
| DELETE | `/vehicles/:id` | Permission `VEHICLE_DELETE` (ADMIN, FLEET_MANAGER) |
| PATCH | `/vehicles/:id/restore` | Permission `VEHICLE_RESTORE` (ADMIN, FLEET_MANAGER) |
| DELETE | `/vehicles/:id/permanent` | Somente ADMIN |

### Trips (`/trips`)

| Método | Rota | Acesso |
|---|---|---|
| GET | `/trips` | ADMIN, FLEET_MANAGER, DRIVER |
| GET | `/trips/deleted/all` | Permission `TRIP_RESTORE` (ADMIN por padrão) |
| GET | `/trips/:id` | ADMIN, FLEET_MANAGER, DRIVER |
| POST | `/trips` | ADMIN, FLEET_MANAGER, DRIVER |
| PATCH | `/trips/:id/start` | ADMIN, FLEET_MANAGER, DRIVER (sem corpo) |
| PATCH | `/trips/:id/end` | ADMIN, FLEET_MANAGER, DRIVER |
| PATCH | `/trips/:id/cancel` | ADMIN, FLEET_MANAGER, DRIVER |
| DELETE | `/trips/:id` | Permission `TRIP_DELETE` (ADMIN por padrão) |
| PATCH | `/trips/:id/restore` | Permission `TRIP_RESTORE` (ADMIN por padrão) |
| DELETE | `/trips/:id/permanent` | Somente ADMIN |

**Escopo do motorista** (motorista = quem não tem o `*_VIEW_ALL` efetivo; ADMIN e FLEET_MANAGER seguem livres): `GET /trips/:id`, `GET /refuelings/:id` e `GET /incidents/:id` respondem `404` para registro de outro motorista; `PATCH /trips/:id/start|end|cancel` de viagem alheia dá `404`; `POST /trips`, `POST /refuelings` e `POST /incidents` com `driverId` que não é o do próprio motorista dão `403` ("driverId must be your own driver profile"). No `POST /incidents`, se o `403` ocorre, a foto enviada é apagada do disco.

**ViaCEP:** só CEP realmente inválido ou inexistente dá `400`. Indisponibilidade da API externa não vira mais "CEP inválido": timeout e rate limit (`429`) do ViaCEP retornam `504`; erro de servidor (5xx), falha de rede e erro inesperado retornam `502`. Vale para `POST /trips` e `POST /vehicles` (`initialLocationCep`).

**Quilometragem da viagem:** `POST /trips` **não recebe km** (enviar qualquer campo de km retorna `400`); o `start_km` provisório é a quilometragem atual do veículo. `PATCH /trips/:id/start` **não recebe corpo** (enviar qualquer campo dá `400`): o `startKm` definitivo é fixado como a quilometragem atual do veículo, que não muda. `PATCH /trips/:id/end` recebe `{ endKm, endLocation }`, em que `endKm` é **quilômetros RODADOS na viagem** (1 a 100.000), não leitura de hodômetro: o servidor soma `endKm` ao hodômetro do veículo. Na resposta, `endKm` volta como o hodômetro final absoluto (`startKm + km rodados`) e `distanceKm` traz a distância percorrida (`endKm - startKm`) — é o que o analytics usa. Veículo inativo (`isActive = false`) é recusado em `create_trip`/`start_trip` com `409` ("Vehicle is not active").

### Refuelings (`/refuelings`)

| Método | Rota | Acesso |
|---|---|---|
| GET | `/refuelings` | ADMIN, FLEET_MANAGER, DRIVER |
| GET | `/refuelings/deleted/all` | Permission `REFUELING_RESTORE` (ADMIN por padrão) |
| GET | `/refuelings/:id` | ADMIN, FLEET_MANAGER, DRIVER (motorista só vê o próprio; alheio: `404`) |
| POST | `/refuelings` | ADMIN, FLEET_MANAGER, DRIVER |
| DELETE | `/refuelings/:id` | Permission `REFUELING_DELETE` (ADMIN por padrão) |
| PATCH | `/refuelings/:id/restore` | Permission `REFUELING_RESTORE` (ADMIN por padrão) |
| DELETE | `/refuelings/:id/permanent` | Somente ADMIN |

### Maintenances (`/maintenances`)

| Método | Rota | Acesso |
|---|---|---|
| GET | `/maintenances` | ADMIN, FLEET_MANAGER |
| GET | `/maintenances/deleted/all` | Permission `MAINTENANCE_RESTORE` (ADMIN, FLEET_MANAGER) |
| GET | `/maintenances/:id` | ADMIN, FLEET_MANAGER |
| POST | `/maintenances` | ADMIN, FLEET_MANAGER |
| PATCH | `/maintenances/:id` | ADMIN, FLEET_MANAGER |
| DELETE | `/maintenances/:id` | Permission `MAINTENANCE_DELETE` (ADMIN, FLEET_MANAGER) |
| PATCH | `/maintenances/:id/restore` | Permission `MAINTENANCE_RESTORE` (ADMIN, FLEET_MANAGER) |
| DELETE | `/maintenances/:id/permanent` | Somente ADMIN |

### Incidents (`/incidents`)

| Método | Rota | Acesso |
|---|---|---|
| GET | `/incidents` | ADMIN, FLEET_MANAGER, DRIVER |
| GET | `/incidents/deleted/all` | Permission `INCIDENT_RESTORE` (ADMIN, FLEET_MANAGER) |
| GET | `/incidents/:id` | ADMIN, FLEET_MANAGER, DRIVER (motorista só vê o próprio; alheio: `404`) |
| POST | `/incidents` | ADMIN, FLEET_MANAGER, DRIVER |
| PATCH | `/incidents/:id/status` | ADMIN, FLEET_MANAGER |
| DELETE | `/incidents/:id` | Permission `INCIDENT_DELETE` (ADMIN, FLEET_MANAGER) |
| PATCH | `/incidents/:id/restore` | Permission `INCIDENT_RESTORE` (ADMIN, FLEET_MANAGER) |
| DELETE | `/incidents/:id/permanent` | Somente ADMIN |

### Analytics (`/analytics`)

Todas as rotas exigem ADMIN ou FLEET_MANAGER.

| Método | Rota |
|---|---|
| GET | `/analytics/fleet/fuel-consumption` |
| GET | `/analytics/fleet/daily-distance` |
| GET | `/analytics/vehicle/:id/efficiency` |
| GET | `/analytics/driver/:id/trips` |
| GET | `/analytics/incidents/severity` |

### Permissions (`/permissions`)

Gestão da delegação granular de permissões (tabela `user_permissions`). Todas as rotas são `ADMIN`-only via `@Roles('ADMIN')` — a própria concessão nunca é delegável, para não permitir escalonamento em cadeia.

| Método | Rota | Papéis |
|---|---|---|
| GET | `/permissions` | ADMIN |
| GET | `/users/:id/permissions` | ADMIN |
| POST | `/users/:id/permissions` | ADMIN |
| DELETE | `/users/:id/permissions/:code` | ADMIN |

### Roles (`/roles`)

Só leitura. Devolve um array `[{ id, name, description }]` ordenado por `name`, com os 3 papéis fixos (`ADMIN`, `DRIVER`, `FLEET_MANAGER`), sem paginação. Serve para montar o `roleId` do formulário de criação de usuário (`POST /users`) e da troca de role (`PATCH /users/:id/role`).

| Método | Rota | Papéis |
|---|---|---|
| GET | `/roles` | Permissão `USER_CREATE` ou `USER_UPDATE` (basta uma): ADMIN e FLEET_MANAGER (este tem `USER_CREATE` por padrão; o front dele só oferece `DRIVER`). DRIVER: `403`; sem token: `401`. |

### Audit logs (`/audit-logs`)

Só leitura: `audit_logs` é append-only (trigger do banco bloqueia `DELETE`, `TRUNCATE` e qualquer `UPDATE`, exceto a anonimização do autor `fk_user_id` -> `NULL`), não existe rota de escrita. `changedBy` pode vir `null` (autor removido).

| Método | Rota | Papéis |
|---|---|---|
| GET | `/audit-logs` | ADMIN (permissão `AUDIT_VIEW`, por papel); outros papéis só via delegação granular (`UserPermission`). Filtros opcionais `entityType`/`entityId`. |

**Total: 77 rotas de negócio** (33 GET, 10 POST, 19 PATCH, 15 DELETE — não existe `PUT` em nenhum recurso) nos 12 controllers acima (o `GET /` da raiz é só o placeholder padrão do `nest new`, e o `GET /health` é infraestrutura — nenhum dos dois faz parte da API de negócio). Nas tabelas acima, "Acesso" lista quem tem acesso **por papel** (`@Roles(...)`, fixo) ou **por permissão** (`@Permissions(...)`, que também aceita delegação granular via `UserPermission` — ver seção 5 de `projectDocs/projeto-fleet-management.md` para o detalhe de qual mecanismo cada rota usa).

## Exclusão: soft delete e deleção total

Soft delete, restore e listagem de removidos (`GET /<recurso>/deleted/all`) são **delegáveis por permission**, uma por recurso: `<R>_DELETE` (soft delete) e `<R>_RESTORE` (restore e `deleted/all`). O ADMIN tem todas; o FLEET_MANAGER tem por padrão só as de vehicles, maintenances e incidents; nos demais recursos só o ADMIN, mas um ADMIN pode delegar (`POST /users/:id/permissions`).

| Recurso | Soft delete (`DELETE /:id`) | Restore e `deleted/all` | Padrão (papéis) | Deleção total (`DELETE /:id/permanent`) |
|---|---|---|---|---|
| users | `USER_DELETE` | `USER_RESTORE` | ADMIN | ADMIN |
| drivers | `DRIVER_DELETE` | `DRIVER_RESTORE` | ADMIN | ADMIN |
| vehicles | `VEHICLE_DELETE` | `VEHICLE_RESTORE` | ADMIN, FLEET_MANAGER | ADMIN |
| trips | `TRIP_DELETE` | `TRIP_RESTORE` | ADMIN | ADMIN |
| refuelings | `REFUELING_DELETE` | `REFUELING_RESTORE` | ADMIN | ADMIN |
| maintenances | `MAINTENANCE_DELETE` | `MAINTENANCE_RESTORE` | ADMIN, FLEET_MANAGER | ADMIN |
| incidents | `INCIDENT_DELETE` | `INCIDENT_RESTORE` | ADMIN, FLEET_MANAGER | ADMIN |

`DRIVER` nunca faz soft delete nem deleção total por padrão. A **deleção total é exclusiva do ADMIN por papel** (`@Roles('ADMIN')`) nos 7 recursos, **sem permission** (não delegável).

**`isActive` em veículos e manutenções:** o soft delete grava `deletedAt` + `isActive = false`; o restore volta `isActive = true`. O campo é somente leitura na API (`PATCH` com `isActive` retorna `400`).

Bloqueios legítimos (resposta `409` em RFC 7807, com `detail` explicando; nunca `500`):

- **Usuário** com `Driver` vinculado, ou que registrou viagens, abastecimentos, manutenções ou incidentes (FK `RESTRICT`, decisão mantida).
- **Motorista** com viagens, abastecimentos ou incidentes.
- **Veículo** com viagens, abastecimentos, manutenções ou incidentes.
- Qualquer outra FK residual cai num `409` genérico (rede de segurança no `SoftDeleteService`).

**Viagem x incidentes:** `DELETE /trips/:id/permanent` só passa se **todos** os incidentes da viagem estiverem `RESOLVED`; senão retorna `409` ("Cannot permanently delete a trip with unresolved incidents. Resolve them first."). Quando passa, os incidentes resolvidos são apagados junto, na mesma transação (sem incidente órfão), e as fotos saem do disco após o commit.

**Auditoria:** `audit_logs.fk_user_id` é anulável, com FK `ON DELETE SET NULL` (migration `20260924120000_anonymize_audit_logs_author`). O histórico de auditoria não impede mais a deleção total de um usuário: as linhas ficam com autor `NULL` (`changedBy: null` em `GET /audit-logs`, "usuário removido"). O trigger continua bloqueando `DELETE` e qualquer `UPDATE`, exceto a transição `fk_user_id` não nulo -> `NULL`. `TRUNCATE audit_logs` (inclusive `... CASCADE` e `TRUNCATE users CASCADE`, que propagaria) também é bloqueado, pelo trigger de statement `trg_block_audit_logs_truncate` (migration `20260924130000_block_audit_logs_truncate`).

**Limitações conhecidas e decisões** (registradas de propósito, não são bugs escondidos):

- **`IsValidCnh` valida só o formato** (11 dígitos), sem os dígitos verificadores.
- **`POST /incidents`:** se a procedure falhar depois do upload, a foto pode ficar órfã no disco (comportamento anterior, não corrigido).
- **Utilitário duplicado:** existem `buscarDriverIdProprio` (qualquer Driver não removido, usado nos escopos) e `buscarDriverIdAtivo` (só Driver ativo, usado em login, refresh e `/users/me`).
- **Os e2e dependem da API pública ViaCEP** (mitigado com `jest.retryTimes(2)`).
- **`POST /users/:id/permissions` devolve `200`**, não `201`.
- **`isActive` de veículo/manutenção é somente leitura** na API.
- **`tripId` de incidente continua opcional** por decisão do usuário.
- **`VEHICLE_VIEW`, `ROLE_MANAGE` e `PERMISSION_MANAGE` seguem sem rota** (decisão consciente).
- **`UPDATE fk_user_id -> NULL` em qualquer linha de `audit_logs`:** aceito por design; nenhum usuário nem a API tem acesso direto ao banco.
- **Resolvidos:** `GET /roles` existe; `TRUNCATE audit_logs` é bloqueado por `trg_block_audit_logs_truncate`; `roleId` saiu de `PATCH/PUT /users/:id`; escopo do motorista fechado; o front recebe `permissions` e `driverId` no login.

## Exemplos de uso (curl)

Fluxo completo: login do ADMIN → listar papéis → criar motorista (recebe a API key) → login do motorista → criar veículo → soft delete → restore. Substitua `<...>` pelos valores reais retornados em cada passo.

```bash
# 1. Login do ADMIN (e-mail + senha no corpo, API key do seed no header)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -H "x-api-key: <API_KEY_DO_ADMIN>" \
  -d '{"email":"<EMAIL_ADMIN>","password":"<SENHA_ADMIN>"}'

# 2. Listar papéis (para pegar o roleId de DRIVER; roleId só é enviado em POST /users e PATCH /users/:id/role)
curl -X GET http://localhost:3000/roles \
  -H "Authorization: Bearer <JWT_DO_PASSO_1>"

# 3. Criar usuário DRIVER (bloco driver é obrigatório; a resposta traz "apiKey" uma única vez)
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_DO_PASSO_1>" \
  -d '{"email":"motorista@fleet.com","password":"SenhaForte123","fullName":"João da Silva","roleId":"<ROLE_ID_DRIVER>","driver":{"licenseNumber":"12345678900","licenseExpiry":"2030-08-30"}}'

# 4. Login do motorista (com a apiKey entregue no passo 3)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -H "x-api-key: <API_KEY_DO_PASSO_3>" \
  -d '{"email":"motorista@fleet.com","password":"SenhaForte123"}'

# 5. Criar um veículo (precisa de ADMIN ou FLEET_MANAGER; use o JWT do passo 1)
curl -X POST http://localhost:3000/vehicles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_DO_PASSO_1>" \
  -d '{"plate":"ABC1D23","model":"Fiat Strada","year":2022}'

# 6. Soft delete do veículo
curl -X DELETE http://localhost:3000/vehicles/<VEHICLE_ID> \
  -H "Authorization: Bearer <JWT_DO_PASSO_1>"

# 7. Restaurar o veículo
curl -X PATCH http://localhost:3000/vehicles/<VEHICLE_ID>/restore \
  -H "Authorization: Bearer <JWT_DO_PASSO_1>"
```

Exemplos extras:

```bash
# Criar veículo informando um CEP (validado/enriquecido contra a API real do ViaCEP,
# devolvido em "initialLocation" na resposta — não é persistido no banco)
curl -X POST http://localhost:3000/vehicles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"plate":"ABC1D23","model":"Fiat Strada","year":2022,"initialLocationCep":"01310-100"}'

# Registrar um incidente com foto (multipart/form-data, campo de arquivo "photo")
curl -X POST http://localhost:3000/incidents \
  -H "Authorization: Bearer <JWT>" \
  -F "vehicleId=<VEHICLE_ID>" \
  -F "driverId=<DRIVER_ID>" \
  -F "type=MECHANICAL_FAILURE" \
  -F "severity=MEDIUM" \
  -F "description=Pane no motor durante a viagem" \
  -F "photo=@caminho/para/foto.jpg"

# Criar viagem (sem km: o start_km provisório é o km atual do veículo)
curl -X POST http://localhost:3000/trips \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"driverId":"<DRIVER_ID>","vehicleId":"<VEHICLE_ID>","startLocation":"01310-100","endLocation":"13010-141"}'

# Iniciar a viagem (sem corpo: o startKm definitivo é o hodômetro atual do veículo)
curl -X PATCH http://localhost:3000/trips/<TRIP_ID>/start \
  -H "Authorization: Bearer <JWT>"

# Encerrar a viagem informando os km RODADOS (não é leitura de hodômetro)
curl -X PATCH http://localhost:3000/trips/<TRIP_ID>/end \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"endKm":120,"endLocation":"Campinas, SP"}'

# Indicador de consumo de combustível da frota
curl -X GET http://localhost:3000/analytics/fleet/fuel-consumption \
  -H "Authorization: Bearer <JWT_ADMIN_OU_FLEET_MANAGER>"
```

## Formato de erro

Todo erro da API (validação, exceção de negócio, erro não tratado) passa pelo `GlobalExceptionFilter` e sai no formato **RFC 7807 (Problem Details)**, `content-type: application/problem+json`:

```json
{
  "type": "https://fleet-management.local/errors/not-found",
  "title": "Recurso não encontrado",
  "status": 404,
  "detail": "User not found",
  "instance": "/users/b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f"
}
```

Em erros de validação (`ValidationPipe` global), aparece um campo extra `errors` (fora do padrão RFC 7807) com uma mensagem por campo inválido:

```json
{
  "type": "https://fleet-management.local/errors/validation-error",
  "title": "Requisição inválida",
  "status": 400,
  "detail": "Um ou mais campos da requisição são inválidos.",
  "instance": "/users",
  "errors": ["email must be an email", "password must be longer than or equal to 8 characters"]
}
```

## Swagger

Com a aplicação rodando, a documentação interativa (OpenAPI) fica em:

```
http://localhost:3000/api/docs
```

(ajuste a porta se `PORT` for diferente de `3000`). Ela documenta todas as rotas de negócio, seus DTOs de entrada/saída, códigos de resposta possíveis e os dois esquemas de segurança (`jwt` para Bearer e `x-api-key` para API key).

**IDs das roles no Swagger:** `POST /users` e `PATCH /users/{id}/role` citam `GET /roles` (fonte dos `roleId`) e mostram na descrição a tabela com os `roleId` reais do ambiente (lidos do banco no boot, por `src/common/swagger/enriquecer-swagger-com-roles.ts`) e 3 exemplos nomeados prontos para executar (DRIVER, FLEET_MANAGER, ADMIN). Os e-mails dos exemplos ganham sufixo aleatório a cada boot, para não colidir com contas existentes. Os IDs de role aparecem em destaque azul (`#0400e0`, texto branco) só nas descrições das operações. Todo `POST`/`PATCH`/`PUT` traz um body de exemplo completo, e as descrições explicam driver × user, `initialLocationCep` (opcional, validado no ViaCEP, não persistido), a quilometragem das viagens, as regras do abastecimento e do incidente (`tripId` é opcional; se informado, a viagem precisa estar `IN_PROGRESS` e bater com veículo e motorista).

## Banco de dados

PostgreSQL 15, modelado com Prisma (12 models + 9 enums), aplicado via **24 migrations**. As regras de integridade mais sensíveis vivem no banco, não só na aplicação:

- **6 procedures**: `create_trip`, `start_trip`, `end_trip`, `cancel_trip`, `register_incident`, `register_refueling`.
- **12 triggers** (com suas funções associadas), cobrindo auditoria append-only (`audit_logs`, bloqueando `DELETE`, `UPDATE` e `TRUNCATE`, com exceção só para anonimizar o autor), sincronização de quilometragem/status do veículo a partir de viagens, e bloqueios de concorrência (ex: impedir duas viagens ativas para o mesmo veículo ou motorista). O abastecimento não sincroniza mais a quilometragem por trigger: `register_refueling` só grava uma foto do hodômetro atual em `refuelings.mileage`, sem alterar `vehicles.current_mileage`.
- **26 CHECK constraints**, validando formato de placa, CNH, e-mail, enums de status/severidade, faixas numéricas, entre outros.

Além disso, `isActive` em `vehicles` e `maintenances` (migration `20260924140000_add_is_active_vehicles_maintenances`) é lido por `create_trip`, `start_trip`, `register_refueling` e `register_incident`, que recusam veículo inativo (`20260924150000_block_inactive_vehicle_in_procedures`); `create_trip` deixou de receber km (`20260924160000_trip_start_km_from_vehicle`).

Contagens confirmadas diretamente no banco (`information_schema.routines`, `pg_trigger`, `pg_constraint`, `_prisma_migrations`) nesta revisão do README.
