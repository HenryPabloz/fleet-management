-- Chave de API do usuário. api_key guarda só o SHA-256 em hex (64 caracteres) da chave, nunca a chave.
-- api_key_created_at não tem default: só é preenchida quando uma chave é gerada.
ALTER TABLE "users"
  ADD COLUMN "api_key" VARCHAR(255),
  ADD COLUMN "api_key_created_at" TIMESTAMP(3),
  ADD COLUMN "api_key_last_used_at" TIMESTAMP(3);

-- O UNIQUE já cria o índice usado na consulta pelo hash.
CREATE UNIQUE INDEX "users_api_key_key" ON "users"("api_key");

ALTER TABLE "users"
  ADD CONSTRAINT ck_users_api_key_hash CHECK (api_key IS NULL OR api_key ~ '^[0-9a-f]{64}$');
