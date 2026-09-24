-- Autor do log pode ficar anonimo (NULL) quando o usuario e apagado de vez.
ALTER TABLE "audit_logs" ALTER COLUMN "fk_user_id" DROP NOT NULL;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_fk_user_id_fkey";
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_fk_user_id_fkey" FOREIGN KEY ("fk_user_id")
  REFERENCES "users"("id_user") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only: so permite tirar o autor (fk_user_id: valor -> NULL), nada mais muda.
CREATE OR REPLACE FUNCTION fn_block_audit_logs_changes() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.fk_user_id IS NOT NULL
     AND NEW.fk_user_id IS NULL
     AND (to_jsonb(OLD) - 'fk_user_id') = (to_jsonb(NEW) - 'fk_user_id') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
