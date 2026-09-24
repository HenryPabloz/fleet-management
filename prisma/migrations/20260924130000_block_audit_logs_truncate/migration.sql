-- Triggers de linha nao pegam TRUNCATE; este trigger de comando fecha essa brecha.
CREATE OR REPLACE FUNCTION fn_block_audit_logs_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (TRUNCATE blocked)';
END;
$$;

REVOKE ALL ON FUNCTION fn_block_audit_logs_truncate() FROM PUBLIC;

CREATE TRIGGER trg_block_audit_logs_truncate
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_block_audit_logs_truncate();
