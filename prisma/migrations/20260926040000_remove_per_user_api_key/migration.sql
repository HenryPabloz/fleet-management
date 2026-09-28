-- A chave de API deixa de ser por usuário e vira uma única chave global (fora do banco).
-- Remove as 3 colunas antigas de users; o unique index de api_key some junto.
ALTER TABLE "users" DROP COLUMN "api_key";
ALTER TABLE "users" DROP COLUMN "api_key_created_at";
ALTER TABLE "users" DROP COLUMN "api_key_last_used_at";
