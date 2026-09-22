-- Triggers de regra de negócio e de auditoria (uma função para cada trigger).
-- Auditoria: o app deve rodar set_config('app.current_user_id', '<uuid>', true) na transação.
-- Sem isso, o "quem alterou" cai para o usuário que criou/registrou a linha (fk_user_id).

-- ============================================================
-- Regras de negócio
-- ============================================================

-- Bloqueia viagem nova para veículo em manutenção, fora de serviço ou em uso.
-- create_trip insere a viagem ANTES de marcar o veículo IN_USE, por isso o fluxo funciona.
CREATE OR REPLACE FUNCTION fn_prevent_vehicle_in_maintenance_from_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vehicle_status "VehicleStatus";
BEGIN
  SELECT v.status INTO v_vehicle_status FROM vehicles v WHERE v.id_vehicle = NEW.fk_vehicle_id;

  IF v_vehicle_status IN ('IN_MAINTENANCE', 'OUT_OF_SERVICE', 'IN_USE') THEN
    RAISE EXCEPTION 'Vehicle is not available (maintenance, out of service, or already in use)';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_vehicle_in_maintenance_from_trip
BEFORE INSERT ON trips
FOR EACH ROW
WHEN (NEW.status IN ('PLANNED', 'IN_PROGRESS'))
EXECUTE FUNCTION fn_prevent_vehicle_in_maintenance_from_trip();

-- Motorista não pode ter duas viagens ativas (ignora a própria linha).
CREATE OR REPLACE FUNCTION fn_prevent_driver_double_active_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trips t
    WHERE t.fk_driver_id = NEW.fk_driver_id
      AND t.status IN ('PLANNED', 'IN_PROGRESS')
      AND t.id_trip <> NEW.id_trip
  ) THEN
    RAISE EXCEPTION 'Driver already has an active trip';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_driver_double_active_trip
BEFORE INSERT OR UPDATE OF status, fk_driver_id ON trips
FOR EACH ROW
WHEN (NEW.status IN ('PLANNED', 'IN_PROGRESS'))
EXECUTE FUNCTION fn_prevent_driver_double_active_trip();

-- Veículo não pode ter duas viagens ativas (ignora a própria linha).
CREATE OR REPLACE FUNCTION fn_prevent_vehicle_double_active_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trips t
    WHERE t.fk_vehicle_id = NEW.fk_vehicle_id
      AND t.status IN ('PLANNED', 'IN_PROGRESS')
      AND t.id_trip <> NEW.id_trip
  ) THEN
    RAISE EXCEPTION 'Vehicle already has an active trip';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_vehicle_double_active_trip
BEFORE INSERT OR UPDATE OF status, fk_vehicle_id ON trips
FOR EACH ROW
WHEN (NEW.status IN ('PLANNED', 'IN_PROGRESS'))
EXECUTE FUNCTION fn_prevent_vehicle_double_active_trip();

-- Quilometragens da viagem: nunca negativas e fim nunca menor que o início.
CREATE OR REPLACE FUNCTION fn_validate_trip_kilometers()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.start_km < 0 THEN
    RAISE EXCEPTION 'Start kilometers cannot be negative';
  END IF;

  IF NEW.end_km IS NOT NULL AND NEW.end_km < 0 THEN
    RAISE EXCEPTION 'End kilometers cannot be negative';
  END IF;

  IF NEW.end_km IS NOT NULL AND NEW.end_km < NEW.start_km THEN
    RAISE EXCEPTION 'End kilometers cannot be less than start kilometers';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_trip_kilometers
BEFORE INSERT OR UPDATE ON trips
FOR EACH ROW
EXECUTE FUNCTION fn_validate_trip_kilometers();

-- ============================================================
-- Auditoria (se falhar, aborta a operação inteira)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_audit_trip_changes()
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
    VALUES (gen_random_uuid(), 'TRIP', NEW.id_trip, 'CREATE', v_user_id, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_user_id IS NULL THEN
      v_user_id := NEW.fk_user_id;
    END IF;
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'TRIP', NEW.id_trip, 'UPDATE', v_user_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF v_user_id IS NULL THEN
    v_user_id := OLD.fk_user_id;
  END IF;
  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'TRIP', OLD.id_trip, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;

CREATE TRIGGER trg_audit_trip_changes
AFTER INSERT OR UPDATE OR DELETE ON trips
FOR EACH ROW
EXECUTE FUNCTION fn_audit_trip_changes();

CREATE OR REPLACE FUNCTION fn_audit_refueling_changes()
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
    VALUES (gen_random_uuid(), 'REFUELING', NEW.id_refueling, 'CREATE', v_user_id, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_user_id IS NULL THEN
      v_user_id := NEW.fk_user_id;
    END IF;
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'REFUELING', NEW.id_refueling, 'UPDATE', v_user_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF v_user_id IS NULL THEN
    v_user_id := OLD.fk_user_id;
  END IF;
  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'REFUELING', OLD.id_refueling, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;

CREATE TRIGGER trg_audit_refueling_changes
AFTER INSERT OR UPDATE OR DELETE ON refuelings
FOR EACH ROW
EXECUTE FUNCTION fn_audit_refueling_changes();

CREATE OR REPLACE FUNCTION fn_audit_incident_changes()
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
    VALUES (gen_random_uuid(), 'INCIDENT', NEW.id_incident, 'CREATE', v_user_id, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_user_id IS NULL THEN
      v_user_id := NEW.fk_user_id;
    END IF;
    INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
    VALUES (gen_random_uuid(), 'INCIDENT', NEW.id_incident, 'UPDATE', v_user_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF v_user_id IS NULL THEN
    v_user_id := OLD.fk_user_id;
  END IF;
  INSERT INTO audit_logs (id_audit_log, entity_type, entity_id, action, fk_user_id, old_values, new_values)
  VALUES (gen_random_uuid(), 'INCIDENT', OLD.id_incident, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Audit failed: %', SQLERRM;
END;
$$;

CREATE TRIGGER trg_audit_incident_changes
AFTER INSERT OR UPDATE OR DELETE ON incidents
FOR EACH ROW
EXECUTE FUNCTION fn_audit_incident_changes();
