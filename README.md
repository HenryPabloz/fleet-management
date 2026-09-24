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

- **Autenticação em duas camadas**: cadastro público (`signup`) → login com e-mail + senha + API key → JWT para as rotas de negócio.
- **RBAC** com 3 papéis (`DRIVER`, `FLEET_MANAGER`, `ADMIN`) e 29 permissões, aplicadas via guards nas rotas.
- **Soft delete** em 7 models (users, drivers, vehicles, trips, refuelings, maintenances, incidents), com `restore` e exclusão permanente (deleção total) separada e exclusiva do `ADMIN`.
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

- **29 permissions** (uma por ação, ex: `TRIP_CREATE`, `VEHICLE_UPDATE`, `AUDIT_VIEW`).
- **3 roles**: `DRIVER`, `FLEET_MANAGER`, `ADMIN`.
- **62 vínculos** role↔permission (10 para `DRIVER`, 23 para `FLEET_MANAGER` — os 10 do `DRIVER` mais 13 extras —, 29 para `ADMIN`, que recebe todas).
- **1 usuário admin**, com API key gerada (ou lida de `ADMIN_API_KEY`) e impressa uma única vez no console fora de produção.

## Testes

```bash
# testes unitários
npm test

# testes end-to-end (sobem a aplicação real contra o banco configurado em DATABASE_URL)
npm run test:e2e
```

No estado atual do repositório: `npm test` roda **1 suíte / 1 teste** (o teste unitário de `AppController`), e `npm run test:e2e` roda **10 suítes / 175 testes** (`analytics`, `app`, `auth-api-key`, `permissions-delegation`, `soft-delete`, `trips-refuelings-incidents`, `users-me-audit-logs`, `vehicles-maintenances`), cobrindo os fluxos de auth, RBAC, delegação granular de permissão (`UserPermission`), CRUD dos 7 recursos principais, soft delete, procedures/triggers, integração com ViaCEP, perfil próprio (`/users/me`) e auditoria (`/audit-logs`).

## Estrutura do projeto

```
src/
├── auth/          # Signup, login (e-mail+senha+API key), JWT, guards, decorators
├── users/         # CRUD de usuários (admin) e perfil próprio
├── drivers/       # CRUD de motoristas
├── vehicles/      # CRUD de veículos (com validação de CEP via ViaCEP)
├── trips/         # Ciclo de viagens: criar, iniciar, encerrar, cancelar
├── refuelings/    # Registro de abastecimentos (via procedure, sincroniza km do veículo)
├── maintenances/  # Registro e acompanhamento de manutenções
├── incidents/     # Registro de incidentes, com upload opcional de foto
├── analytics/     # Indicadores de frota (consumo, distância, eficiência, incidentes)
├── permissions/   # Delegação granular de permissões (UserPermission), ADMIN-only
├── external/
│   └── viacep/    # Cliente HTTP para a API pública do ViaCEP
├── common/        # DTOs, interceptors, pipes, validators, utils e schemas compartilhados
├── database/      # Módulo/serviço do Prisma (conexão com o PostgreSQL)
├── config/        # Validação e leitura da configuração (variáveis de ambiente)
└── generated/     # Prisma Client gerado (não editar manualmente)
```

Cada módulo de recurso (`drivers`, `vehicles`, `trips`, `refuelings`, `maintenances`, `incidents`, `users`, `permissions`) segue o mesmo padrão: `*.controller.ts`, `*.service.ts`, `*.module.ts` e uma pasta `dto/`.

## Autenticação

Fluxo real, em duas camadas:

1. **Signup** (`POST /auth/signup`, público): cria um usuário com papel `DRIVER` fixo e devolve uma **API key em texto puro** (o banco guarda só o hash SHA-256 dela — ela não aparece de novo depois).
2. **Login** (`POST /auth/login`): exige e-mail + senha no corpo **e** a API key no header `x-api-key`. Devolve um **JWT**.
3. **Rotas de negócio**: exigem o JWT no header `Authorization: Bearer <token>`. Cada rota é restrita por papel fixo (`@Roles(...)`) ou por permissão delegável (`@Permissions(...)`), ambos avaliados pelo `RolesGuard` — ver [seção Endpoints](#endpoints) e `projectDocs/projeto-fleet-management.md` (seção 5) para o detalhe de qual mecanismo cada rota usa.
4. **Renovação**: `PATCH /auth/regenerate-key` troca a API key (autenticado por `x-api-key`); `POST /auth/refresh-token` troca o JWT (autenticado por Bearer) — são rotas e credenciais diferentes, não confundir.

Para o detalhe completo (guards, estratégias, matriz de permissões, RBAC) veja `markdown/SEGURANCA-E-AUTENTICACAO.md`.

## Endpoints

Autenticação: **pública** (sem guard), **API key** (header `x-api-key`) ou **JWT** (header `Authorization: Bearer`, + papéis exigidos). Documentação interativa completa, com request/response de cada rota, em `/api/docs` (Swagger) — ver [seção Swagger](#swagger).

### Health (`/health`)

| Método | Rota | Autenticação |
|---|---|---|
| GET | `/health` | Pública (sem autenticação, fora do rate limiting) |

### Auth (`/auth`)

| Método | Rota | Autenticação |
|---|---|---|
| POST | `/auth/signup` | Pública |
| POST | `/auth/login` | API key |
| PATCH | `/auth/regenerate-key` | API key |
| POST | `/auth/refresh-token` | JWT |

### Users (`/users`)

| Método | Rota | Papéis |
|---|---|---|
| GET | `/users` | ADMIN, FLEET_MANAGER |
| GET | `/users/deleted/all` | ADMIN |
| GET | `/users/me` | ADMIN, FLEET_MANAGER, DRIVER (permissão `PROFILE_VIEW`) |
| PATCH | `/users/me` | ADMIN, FLEET_MANAGER, DRIVER (permissão `PROFILE_UPDATE_OWN`) |
| PATCH | `/users/me/password` | ADMIN, FLEET_MANAGER, DRIVER (permissão `PASSWORD_CHANGE_OWN`) |
| GET | `/users/:id` | ADMIN, FLEET_MANAGER |
| POST | `/users` | ADMIN |
| PATCH | `/users/:id` | ADMIN |
| PUT | `/users/:id` | ADMIN |
| DELETE | `/users/:id` | ADMIN (permissão `USER_DELETE`, por papel) |
| PATCH | `/users/:id/restore` | ADMIN |
| DELETE | `/users/:id/permanent` | ADMIN |

### Drivers (`/drivers`)

| Método | Rota | Papéis |
|---|---|---|
| GET | `/drivers` | ADMIN, FLEET_MANAGER |
| GET | `/drivers/deleted/all` | ADMIN |
| GET | `/drivers/:id` | ADMIN, FLEET_MANAGER |
| POST | `/drivers` | ADMIN, FLEET_MANAGER (permissão `DRIVER_CREATE`) |
| PATCH | `/drivers/:id` | ADMIN, FLEET_MANAGER (permissão `DRIVER_UPDATE`) |
| PUT | `/drivers/:id` | ADMIN, FLEET_MANAGER (permissão `DRIVER_UPDATE`) |
| DELETE | `/drivers/:id` | ADMIN |
| PATCH | `/drivers/:id/restore` | ADMIN |
| DELETE | `/drivers/:id/permanent` | ADMIN |

### Vehicles (`/vehicles`)

| Método | Rota | Papéis |
|---|---|---|
| GET | `/vehicles` | ADMIN, FLEET_MANAGER, DRIVER |
| GET | `/vehicles/deleted/all` | ADMIN, FLEET_MANAGER |
| GET | `/vehicles/:id` | ADMIN, FLEET_MANAGER, DRIVER |
| POST | `/vehicles` | ADMIN, FLEET_MANAGER |
| PATCH | `/vehicles/:id` | ADMIN, FLEET_MANAGER |
| PUT | `/vehicles/:id` | ADMIN, FLEET_MANAGER |
| DELETE | `/vehicles/:id` | ADMIN, FLEET_MANAGER |
| PATCH | `/vehicles/:id/restore` | ADMIN, FLEET_MANAGER |
| DELETE | `/vehicles/:id/permanent` | ADMIN |

### Trips (`/trips`)

| Método | Rota | Papéis |
|---|---|---|
| GET | `/trips` | ADMIN, FLEET_MANAGER, DRIVER |
| GET | `/trips/deleted/all` | ADMIN |
| GET | `/trips/:id` | ADMIN, FLEET_MANAGER, DRIVER |
| POST | `/trips` | ADMIN, FLEET_MANAGER, DRIVER |
| PATCH | `/trips/:id/start` | ADMIN, FLEET_MANAGER, DRIVER |
| PATCH | `/trips/:id/end` | ADMIN, FLEET_MANAGER, DRIVER |
| PATCH | `/trips/:id/cancel` | ADMIN, FLEET_MANAGER, DRIVER |
| DELETE | `/trips/:id` | ADMIN |
| PATCH | `/trips/:id/restore` | ADMIN |
| DELETE | `/trips/:id/permanent` | ADMIN |

### Refuelings (`/refuelings`)

| Método | Rota | Papéis |
|---|---|---|
| GET | `/refuelings` | ADMIN, FLEET_MANAGER, DRIVER |
| GET | `/refuelings/deleted/all` | ADMIN |
| GET | `/refuelings/:id` | ADMIN, FLEET_MANAGER, DRIVER |
| POST | `/refuelings` | ADMIN, FLEET_MANAGER, DRIVER |
| DELETE | `/refuelings/:id` | ADMIN |
| PATCH | `/refuelings/:id/restore` | ADMIN |
| DELETE | `/refuelings/:id/permanent` | ADMIN |

### Maintenances (`/maintenances`)

| Método | Rota | Papéis |
|---|---|---|
| GET | `/maintenances` | ADMIN, FLEET_MANAGER |
| GET | `/maintenances/deleted/all` | ADMIN, FLEET_MANAGER |
| GET | `/maintenances/:id` | ADMIN, FLEET_MANAGER |
| POST | `/maintenances` | ADMIN, FLEET_MANAGER |
| PATCH | `/maintenances/:id` | ADMIN, FLEET_MANAGER |
| PUT | `/maintenances/:id` | ADMIN, FLEET_MANAGER |
| DELETE | `/maintenances/:id` | ADMIN, FLEET_MANAGER |
| PATCH | `/maintenances/:id/restore` | ADMIN, FLEET_MANAGER |
| DELETE | `/maintenances/:id/permanent` | ADMIN |

### Incidents (`/incidents`)

| Método | Rota | Papéis |
|---|---|---|
| GET | `/incidents` | ADMIN, FLEET_MANAGER, DRIVER |
| GET | `/incidents/deleted/all` | ADMIN, FLEET_MANAGER |
| GET | `/incidents/:id` | ADMIN, FLEET_MANAGER, DRIVER |
| POST | `/incidents` | ADMIN, FLEET_MANAGER, DRIVER |
| PATCH | `/incidents/:id/status` | ADMIN, FLEET_MANAGER |
| DELETE | `/incidents/:id` | ADMIN, FLEET_MANAGER |
| PATCH | `/incidents/:id/restore` | ADMIN, FLEET_MANAGER |
| DELETE | `/incidents/:id/permanent` | ADMIN |

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

### Audit logs (`/audit-logs`)

Só leitura: `audit_logs` é append-only (trigger do banco bloqueia `DELETE` e qualquer `UPDATE`, exceto a anonimização do autor `fk_user_id` -> `NULL`), não existe rota de escrita. `changedBy` pode vir `null` (autor removido).

| Método | Rota | Papéis |
|---|---|---|
| GET | `/audit-logs` | ADMIN (permissão `AUDIT_VIEW`, por papel); outros papéis só via delegação granular (`UserPermission`). Filtros opcionais `entityType`/`entityId`. |

**Total: 78 rotas de negócio** nos 11 controllers acima (o `GET /` da raiz é só o placeholder padrão do `nest new`, e o `GET /health` é infraestrutura — nenhum dos dois faz parte da API de negócio). Nas tabelas acima, "Papéis" lista quem tem acesso **por papel** (`@Roles(...)`, fixo) ou **por permissão** (`@Permissions(...)`, que também aceita delegação granular via `UserPermission` — ver seção 5 de `projectDocs/projeto-fleet-management.md` para o detalhe de qual mecanismo cada rota usa).

## Exclusão: soft delete e deleção total

| Recurso | Soft delete (`DELETE /:id`) | Restore | Deleção total (`DELETE /:id/permanent`) |
|---|---|---|---|
| users | ADMIN (permissão `USER_DELETE`) | ADMIN | ADMIN |
| drivers | ADMIN | ADMIN | ADMIN |
| vehicles | ADMIN, FLEET_MANAGER | ADMIN, FLEET_MANAGER | ADMIN |
| trips | ADMIN | ADMIN | ADMIN |
| refuelings | ADMIN | ADMIN | ADMIN |
| maintenances | ADMIN, FLEET_MANAGER | ADMIN, FLEET_MANAGER | ADMIN |
| incidents | ADMIN, FLEET_MANAGER | ADMIN, FLEET_MANAGER | ADMIN |

`DRIVER` nunca faz soft delete nem deleção total. A deleção total é **exclusiva do ADMIN** nos 7 recursos.

Bloqueios legítimos (resposta `409` em RFC 7807, com `detail` explicando; nunca `500`):

- **Usuário** com `Driver` vinculado, ou que registrou viagens, abastecimentos, manutenções ou incidentes (FK `RESTRICT`, decisão mantida).
- **Motorista** com viagens, abastecimentos ou incidentes.
- **Veículo** com viagens, abastecimentos, manutenções ou incidentes.
- Qualquer outra FK residual cai num `409` genérico (rede de segurança no `SoftDeleteService`).

**Viagem x incidentes:** `DELETE /trips/:id/permanent` só passa se **todos** os incidentes da viagem estiverem `RESOLVED`; senão retorna `409` ("Cannot permanently delete a trip with unresolved incidents. Resolve them first."). Quando passa, os incidentes resolvidos são apagados junto, na mesma transação (sem incidente órfão), e as fotos saem do disco após o commit.

**Auditoria:** `audit_logs.fk_user_id` é anulável, com FK `ON DELETE SET NULL` (migration `20260924120000_anonymize_audit_logs_author`). O histórico de auditoria não impede mais a deleção total de um usuário: as linhas ficam com autor `NULL` (`changedBy: null` em `GET /audit-logs`, "usuário removido"). O trigger continua bloqueando `DELETE` e qualquer `UPDATE`, exceto a transição `fk_user_id` não nulo -> `NULL`.

**Pendências e limitações conhecidas:**

- **Não existe `GET /roles`.** Um front não consegue listar os papéis para um select; hoje os `roleId` só aparecem na descrição do Swagger. É pendência que depende de decisão do dono do projeto, não comportamento intencional.
- O trigger de `audit_logs` permite `UPDATE fk_user_id -> NULL` em qualquer linha: quem tem acesso direto ao banco poderia anonimizar o autor de um registro.
- `TRUNCATE audit_logs` não é bloqueado (já era assim antes). Sugestão: trigger de statement `BEFORE TRUNCATE`.

## Exemplos de uso (curl)

Fluxo completo: signup → login → criar recurso → soft delete → restore. Substitua `<...>` pelos valores reais retornados em cada passo.

```bash
# 1. Signup (cria usuário DRIVER e devolve a API key em texto puro)
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"motorista@fleet.com","password":"SenhaForte123","fullName":"João da Silva"}'

# 2. Login (e-mail + senha no corpo, API key no header)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -H "x-api-key: <API_KEY_DO_PASSO_1>" \
  -d '{"email":"motorista@fleet.com","password":"SenhaForte123"}'

# 3. Criar um veículo (precisa de papel ADMIN ou FLEET_MANAGER)
curl -X POST http://localhost:3000/vehicles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_DO_PASSO_2>" \
  -d '{"plate":"ABC1D23","model":"Fiat Strada","year":2022}'

# 4. Soft delete do veículo
curl -X DELETE http://localhost:3000/vehicles/<VEHICLE_ID> \
  -H "Authorization: Bearer <JWT>"

# 5. Restaurar o veículo
curl -X PATCH http://localhost:3000/vehicles/<VEHICLE_ID>/restore \
  -H "Authorization: Bearer <JWT>"
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
  "instance": "/auth/signup",
  "errors": ["email must be an email", "password must be longer than or equal to 8 characters"]
}
```

## Swagger

Com a aplicação rodando, a documentação interativa (OpenAPI) fica em:

```
http://localhost:3000/api/docs
```

(ajuste a porta se `PORT` for diferente de `3000`). Ela documenta todas as rotas de negócio, seus DTOs de entrada/saída, códigos de resposta possíveis e os dois esquemas de segurança (`jwt` para Bearer e `x-api-key` para API key).

**IDs das roles no Swagger:** `POST /users`, `PATCH /users/:id` e `PUT /users/:id` mostram na descrição a tabela com os `roleId` reais do ambiente (lidos do banco no boot, por `src/common/swagger/enriquecer-swagger-com-roles.ts`) e 3 exemplos nomeados prontos para executar (DRIVER, FLEET_MANAGER, ADMIN). Os e-mails dos exemplos ganham sufixo aleatório a cada boot, para não colidir com contas existentes.

## Banco de dados

PostgreSQL 15, modelado com Prisma (12 models + 9 enums), aplicado via **18 migrations**. As regras de integridade mais sensíveis vivem no banco, não só na aplicação:

- **6 procedures**: `create_trip`, `start_trip`, `end_trip`, `cancel_trip`, `register_incident`, `register_refueling`.
- **12 triggers** (com suas 12 funções associadas), cobrindo auditoria append-only (`audit_logs`, com exceção só para anonimizar o autor), sincronização de quilometragem/status do veículo a partir de viagens e abastecimentos, e bloqueios de concorrência (ex: impedir duas viagens ativas para o mesmo veículo ou motorista).
- **26 CHECK constraints**, validando formato de placa, CNH, e-mail, enums de status/severidade, faixas numéricas, entre outros.

Contagens confirmadas diretamente no banco (`information_schema.routines`, `pg_trigger`, `pg_constraint`, `_prisma_migrations`) nesta revisão do README.
