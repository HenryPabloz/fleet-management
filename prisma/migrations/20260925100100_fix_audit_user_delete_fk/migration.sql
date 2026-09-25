-- Corrige fn_audit_user_changes: no hard delete de USER, cair para OLD.id_user quebra a FK
-- de audit_logs.fk_user_id (o usuario ja foi apagado nesse ponto). Sem contexto, autor fica NULL.
CREATE OR REPLACE FUNCTION fn_audit_user_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::uuid;

  IF TG_OP = 'INSERT' THEN
    IF v_user_id IS NULL THEN
      v_user_id := NEW.id_user;
    END IF;
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'USER', NEW.id_user, 'CREATE', v_user_id, NULL, to_jsonb(NEW) - 'password' - 'api_key');
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_user_id IS NULL THEN
      v_user_id := NEW.id_user;
    END IF;
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'USER', NEW.id_user, 'UPDATE', v_user_id, to_jsonb(OLD) - 'password' - 'api_key', to_jsonb(NEW) - 'password' - 'api_key');
    RETURN NEW;
  END IF;

  -- DELETE: OLD.id_user ja nao existe mais em users, entao nao serve de fallback (violaria a FK).
  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'USER', OLD.id_user, 'DELETE', v_user_id, to_jsonb(OLD) - 'password' - 'api_key', NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;
