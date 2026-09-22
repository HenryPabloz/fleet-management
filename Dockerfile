# Dockerfile multi-stage da API (NestJS). Stage 1 compila, stage 2 só roda.
# Node 24 porque é a versão usada no projeto (ver README.md "Stack e versões").

# ---------- Stage 1: build ----------
FROM node:24-alpine AS build

WORKDIR /app

# Copia primeiro só o que define as dependências, pra aproveitar o cache do Docker.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

# Gera o Prisma Client em src/generated/prisma (path definido no schema.prisma).
RUN npx prisma generate

# Agora copia o resto do código-fonte e compila.
COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# node_modules vem inteiro do stage de build: o Prisma CLI (usado no "prisma migrate
# deploy" do CMD abaixo) é devDependency, então um "npm ci --omit=dev" aqui não o traria.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Cria um usuário sem privilégios de root pra rodar a aplicação.
RUN addgroup -S fleet && adduser -S fleet -G fleet
# Pasta de uploads precisa existir e pertencer ao usuário da aplicação (ela é montada
# como volume no docker-compose, mas o dono do diretório precisa estar certo mesmo assim).
RUN mkdir -p /app/uploads/incidents && chown -R fleet:fleet /app
USER fleet

EXPOSE 3000

# Aplica as migrations pendentes e só depois sobe a aplicação compilada.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
