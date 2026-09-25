-- Corrige fn_audit_driver_changes: drivers_fk_user_id_fkey tem ON DELETE CASCADE.
-- Ao apagar o usuario, o driver cai em cascata e OLD.fk_user_id (o proprio usuario apagado) nao serve de fallback.
CREATE OR REPLACE FUNCTION fn_audit_driver_changes()
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
      v_user_id := NEW.fk_user_id;
    END IF;
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'DRIVER', NEW.id_driver, 'CREATE', v_user_id, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_user_id IS NULL THEN
      v_user_id := NEW.fk_user_id;
    END IF;
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'DRIVER', NEW.id_driver, 'UPDATE', v_user_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  -- DELETE: OLD.fk_user_id pode ja ter sido apagado em cascata (drivers -> ON DELETE CASCADE em users).
  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'DRIVER', OLD.id_driver, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;
