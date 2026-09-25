-- Auditoria: mesmo padrao de trg_audit_trip_changes/refueling/incident.
-- Cobre acoes administrativas sensiveis (promover papel, ativar/desativar, hard delete, corrigir hodometro).

-- users: nunca grava password nem api_key em old_values/new_values (dado sensivel).
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

  IF v_user_id IS NULL THEN
    v_user_id := OLD.id_user;
  END IF;
  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'USER', OLD.id_user, 'DELETE', v_user_id, to_jsonb(OLD) - 'password' - 'api_key', NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;

CREATE TRIGGER trg_audit_user_changes
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION fn_audit_user_changes();

-- drivers: sem dado sensivel para mascarar.
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

  IF v_user_id IS NULL THEN
    v_user_id := OLD.fk_user_id;
  END IF;
  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'DRIVER', OLD.id_driver, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;

CREATE TRIGGER trg_audit_driver_changes
AFTER INSERT OR UPDATE OR DELETE ON drivers
FOR EACH ROW
EXECUTE FUNCTION fn_audit_driver_changes();

-- vehicles: nao tem fk_user_id proprio; sem app.current_user_id o autor fica NULL (coluna e nullable).
CREATE OR REPLACE FUNCTION fn_audit_vehicle_changes()
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
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'VEHICLE', NEW.id_vehicle, 'CREATE', v_user_id, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'VEHICLE', NEW.id_vehicle, 'UPDATE', v_user_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'VEHICLE', OLD.id_vehicle, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;

CREATE TRIGGER trg_audit_vehicle_changes
AFTER INSERT OR UPDATE OR DELETE ON vehicles
FOR EACH ROW
EXECUTE FUNCTION fn_audit_vehicle_changes();

-- maintenances: mesmo padrao, autor cai para quem registrou (fk_user_id) se o contexto nao vier.
CREATE OR REPLACE FUNCTION fn_audit_maintenance_changes()
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
    VALUES (gen_random_uuid(), 'MAINTENANCE', NEW.id_maintenance, 'CREATE', v_user_id, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_user_id IS NULL THEN
      v_user_id := NEW.fk_user_id;
    END IF;
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'MAINTENANCE', NEW.id_maintenance, 'UPDATE', v_user_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF v_user_id IS NULL THEN
    v_user_id := OLD.fk_user_id;
  END IF;
  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'MAINTENANCE', OLD.id_maintenance, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;

CREATE TRIGGER trg_audit_maintenance_changes
AFTER INSERT OR UPDATE OR DELETE ON maintenances
FOR EACH ROW
EXECUTE FUNCTION fn_audit_maintenance_changes();
