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
- [Exemplos de uso (curl)](#exemplos-de-uso-curl)
- [Swagger](#swagger)
- [Banco de dados](#banco-de-dados)

## Principais capacidades

- **Autenticação em duas camadas**: cadastro público (`signup`) → login com e-mail + senha + API key → JWT para as rotas de negócio.
- **RBAC** com 3 papéis (`DRIVER`, `FLEET_MANAGER`, `ADMIN`) e 29 permissões, aplicadas via guards nas rotas.
- **Soft delete** em 7 models (users, drivers, vehicles, trips, refuelings, maintenances, incidents), com `restore` e exclusão permanente separada.
- **Regras de negócio no banco**: procedures e triggers em PostgreSQL garantem integridade (ex: não permitir duas viagens ativas para o mesmo veículo/motorista, sincronizar quilometragem, auditoria append-only).
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

No estado atual do repositório: `npm test` roda **1 suíte / 1 teste** (o teste unitário de `AppController`), e `npm run test:e2e` roda **6 suítes / 99 testes**, cobrindo os fluxos de auth, RBAC, CRUD dos 7 recursos principais, soft delete, procedures/triggers e integração com ViaCEP.

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
├── external/
│   └── viacep/    # Cliente HTTP para a API pública do ViaCEP
├── common/        # DTOs, interceptors, pipes, validators, utils e schemas compartilhados
├── database/      # Módulo/serviço do Prisma (conexão com o PostgreSQL)
├── config/        # Validação e leitura da configuração (variáveis de ambiente)
└── generated/     # Prisma Client gerado (não editar manualmente)
```

Cada módulo de recurso (`drivers`, `vehicles`, `trips`, `refuelings`, `maintenances`, `incidents`, `users`) segue o mesmo padrão: `*.controller.ts`, `*.service.ts`, `*.module.ts` e uma pasta `dto/`.

## Autenticação

Fluxo real, em duas camadas:

1. **Signup** (`POST /auth/signup`, público): cria um usuário com papel `DRIVER` fixo e devolve uma **API key em texto puro** (o banco guarda só o hash SHA-256 dela — ela não aparece de novo depois).
2. **Login** (`POST /auth/login`): exige e-mail + senha no corpo **e** a API key no header `x-api-key`. Devolve um **JWT**.
3. **Rotas de negócio**: exigem o JWT no header `Authorization: Bearer <token>`. Cada rota é restrita por papel (`@Roles(...)`) via `RolesGuard`.
4. **Renovação**: `PATCH /auth/regenerate-key` troca a API key (autenticado por `x-api-key`); `POST /auth/refresh-token` troca o JWT (autenticado por Bearer) — são rotas e credenciais diferentes, não confundir.

Para o detalhe completo (guards, estratégias, matriz de permissões, RBAC) veja `markdown/SEGURANCA-E-AUTENTICACAO.md`.

## Endpoints

Autenticação: **pública** (sem guard), **API key** (header `x-api-key`) ou **JWT** (header `Authorization: Bearer`, + papéis exigidos). Documentação interativa completa, com request/response de cada rota, em `/api/docs` (Swagger) — ver [seção Swagger](#swagger).

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
| GET | `/users/:id` | ADMIN, FLEET_MANAGER |
| POST | `/users` | ADMIN |
| PATCH | `/users/:id` | ADMIN |
| PUT | `/users/:id` | ADMIN |
| DELETE | `/users/:id` | ADMIN |
| PATCH | `/users/:id/restore` | ADMIN |
| DELETE | `/users/:id/permanent` | ADMIN |

### Drivers (`/drivers`)

| Método | Rota | Papéis |
|---|---|---|
| GET | `/drivers` | ADMIN, FLEET_MANAGER |
| GET | `/drivers/deleted/all` | ADMIN |
| GET | `/drivers/:id` | ADMIN, FLEET_MANAGER |
| POST | `/drivers` | ADMIN |
| PATCH | `/drivers/:id` | ADMIN |
| PUT | `/drivers/:id` | ADMIN |
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
| DELETE | `/vehicles/:id/permanent` | ADMIN, FLEET_MANAGER |

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
| DELETE | `/maintenances/:id/permanent` | ADMIN, FLEET_MANAGER |

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
| DELETE | `/incidents/:id/permanent` | ADMIN, FLEET_MANAGER |

### Analytics (`/analytics`)

Todas as rotas exigem ADMIN ou FLEET_MANAGER.

| Método | Rota |
|---|---|
| GET | `/analytics/fleet/fuel-consumption` |
| GET | `/analytics/fleet/daily-distance` |
| GET | `/analytics/vehicle/:id/efficiency` |
| GET | `/analytics/driver/:id/trips` |
| GET | `/analytics/incidents/severity` |

**Total: 70 rotas de negócio** nos 9 controllers acima (o `GET /` da raiz é só o placeholder padrão do `nest new`, não faz parte da API de negócio).

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

## Swagger

Com a aplicação rodando, a documentação interativa (OpenAPI) fica em:

```
http://localhost:3000/api/docs
```

(ajuste a porta se `PORT` for diferente de `3000`). Ela documenta todas as rotas de negócio, seus DTOs de entrada/saída, códigos de resposta possíveis e os dois esquemas de segurança (`jwt` para Bearer e `x-api-key` para API key).

## Banco de dados

PostgreSQL 15, modelado com Prisma (12 models + 9 enums), aplicado via **17 migrations**. As regras de integridade mais sensíveis vivem no banco, não só na aplicação:

- **6 procedures**: `create_trip`, `start_trip`, `end_trip`, `cancel_trip`, `register_incident`, `register_refueling`.
- **12 triggers** (com suas 12 funções associadas), cobrindo auditoria append-only (`audit_logs`), sincronização de quilometragem/status do veículo a partir de viagens e abastecimentos, e bloqueios de concorrência (ex: impedir duas viagens ativas para o mesmo veículo ou motorista).
- **26 CHECK constraints**, validando formato de placa, CNH, e-mail, enums de status/severidade, faixas numéricas, entre outros.

Contagens confirmadas diretamente no banco (`information_schema.routines`, `pg_trigger`, `pg_constraint`) nesta revisão do README.
