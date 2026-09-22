-- Rodada 2 do QA: concorrência, quilometragem por SQL direto, procedures mais rígidas,
-- auditoria mais limpa e permissões. Uma role de aplicação futura precisa de
-- GRANT EXECUTE nas 6 procedures (create_trip, start_trip, end_trip, cancel_trip,
-- register_refueling, register_incident), pois o EXECUTE de PUBLIC foi revogado aqui.

-- ============================================================
-- 1) Corrida de motorista/veículo: trava por advisory lock antes do EXISTS
-- A 2ª sessão espera a 1ª terminar e depois enxerga a viagem já gravada.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_prevent_driver_double_active_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Chave da trava do motorista (semente 1, diferente da do veículo)
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.fk_driver_id::text, 1));

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

CREATE OR REPLACE FUNCTION fn_prevent_vehicle_double_active_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Chave da trava do veículo (semente 2, diferente da do motorista)
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.fk_vehicle_id::text, 2));

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

-- ============================================================
-- 3) Quilometragem do veículo também por SQL direto
-- ============================================================
CREATE OR REPLACE FUNCTION fn_sync_vehicle_mileage_from_refueling()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A quilometragem do veículo só sobe (o trigger de proteção impede descer)
  UPDATE vehicles
  SET current_mileage = NEW.mileage, updated_at = NOW()
  WHERE id_vehicle = NEW.fk_vehicle_id AND current_mileage < NEW.mileage;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_vehicle_mileage_from_refueling
AFTER INSERT OR UPDATE OF mileage, fk_vehicle_id ON refuelings
FOR EACH ROW
EXECUTE FUNCTION fn_sync_vehicle_mileage_from_refueling();

-- O trigger de sincronização da viagem também dispara quando end_km muda
DROP TRIGGER trg_sync_vehicle_from_trip ON trips;

CREATE TRIGGER trg_sync_vehicle_from_trip
AFTER INSERT OR DELETE OR UPDATE OF status, fk_vehicle_id, end_km ON trips
FOR EACH ROW
EXECUTE FUNCTION fn_sync_vehicle_from_trip();

-- ============================================================
-- 9) Auditoria: sem log quando o UPDATE não muda nada + tabela só de inserção
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
  IF TG_OP = 'UPDATE' THEN
    -- UPDATE sem mudança real (só updated_at) não gera log
    IF (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;

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

CREATE OR REPLACE FUNCTION fn_audit_refueling_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;

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

CREATE OR REPLACE FUNCTION fn_audit_incident_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;

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

-- audit_logs é só de inserção: nunca altera nem apaga linha
CREATE OR REPLACE FUNCTION fn_block_audit_logs_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER trg_block_audit_logs_changes
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION fn_block_audit_logs_changes();

-- ============================================================
-- Procedures (mesmas assinaturas: CREATE OR REPLACE)
-- ============================================================

-- create_trip: CNH vencida, usuários ativos, teto de km
CREATE OR REPLACE PROCEDURE create_trip(
  p_driver_id UUID,
  p_vehicle_id UUID,
  p_start_km INT,
  p_start_location TEXT,
  p_end_location TEXT,
  p_created_by UUID,
  OUT id UUID,
  OUT status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_creator_active BOOLEAN;
  v_driver_active BOOLEAN;
  v_driver_license_expiry DATE;
  v_driver_user_active BOOLEAN;
  v_vehicle_status "VehicleStatus";
  v_vehicle_mileage INT;
  v_start_location TEXT;
  v_end_location TEXT;
BEGIN
  -- Usuário que cria precisa existir e estar ativo
  IF p_created_by IS NOT NULL THEN
    SELECT u.is_active INTO v_creator_active FROM users u WHERE u.id_user = p_created_by;
  END IF;
  IF p_created_by IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF NOT v_creator_active THEN
    RAISE EXCEPTION 'User is not active';
  END IF;

  -- Locais (com trim) precisam ser válidos
  v_start_location := btrim(p_start_location);
  IF v_start_location IS NULL OR v_start_location = '' THEN
    RAISE EXCEPTION 'Start location cannot be empty';
  END IF;

  v_end_location := btrim(p_end_location);
  IF v_end_location IS NULL OR v_end_location = '' THEN
    RAISE EXCEPTION 'End location cannot be empty';
  END IF;

  IF char_length(v_start_location) > 255 OR char_length(v_end_location) > 255 THEN
    RAISE EXCEPTION 'Location cannot be longer than 255 characters';
  END IF;

  -- Motorista precisa existir, estar ativo, com CNH válida e usuário ativo
  SELECT d.is_active, d.license_expiry, u.is_active
  INTO v_driver_active, v_driver_license_expiry, v_driver_user_active
  FROM drivers d
  JOIN users u ON u.id_user = d.fk_user_id
  WHERE d.id_driver = p_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  IF NOT v_driver_active THEN
    RAISE EXCEPTION 'Driver is not active';
  END IF;

  IF NOT v_driver_user_active THEN
    RAISE EXCEPTION 'Driver user is not active';
  END IF;

  IF v_driver_license_expiry < CURRENT_DATE THEN
    RAISE EXCEPTION 'Driver license expired';
  END IF;

  -- Veículo precisa existir (trava a linha para ninguém mexer ao mesmo tempo)
  SELECT v.status, v.current_mileage INTO v_vehicle_status, v_vehicle_mileage
  FROM vehicles v
  WHERE v.id_vehicle = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  -- Só veículo AVAILABLE pode ter viagem marcada
  IF v_vehicle_status = 'IN_USE' THEN
    RAISE EXCEPTION 'Vehicle is in use';
  END IF;

  IF v_vehicle_status = 'IN_MAINTENANCE' THEN
    RAISE EXCEPTION 'Vehicle is under maintenance';
  END IF;

  IF v_vehicle_status = 'OUT_OF_SERVICE' THEN
    RAISE EXCEPTION 'Vehicle is out of service';
  END IF;

  -- Quilometragem inicial: não negativa, dentro do teto e não menor que a do veículo
  IF p_start_km IS NULL OR p_start_km < 0 THEN
    RAISE EXCEPTION 'Start km cannot be negative';
  END IF;

  IF p_start_km > 10000000 THEN
    RAISE EXCEPTION 'Start km exceeds the maximum allowed (10000000)';
  END IF;

  IF p_start_km < v_vehicle_mileage THEN
    RAISE EXCEPTION 'Start km cannot be less than vehicle current mileage (%)', v_vehicle_mileage;
  END IF;

  INSERT INTO trips (id_trip, fk_driver_id, fk_vehicle_id, status, start_km, start_location, end_location, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_driver_id, p_vehicle_id, 'PLANNED', p_start_km, v_start_location, v_end_location, p_created_by, NOW())
  RETURNING trips.id_trip INTO id;

  -- O trigger de sincronização já marca IN_USE; aqui só garantimos (não muda nada se já estiver)
  UPDATE vehicles
  SET status = 'IN_USE', updated_at = NOW()
  WHERE id_vehicle = p_vehicle_id;

  status := 'PLANNED';
END;
$$;

-- start_trip: veículo obrigatório e teto de km
CREATE OR REPLACE PROCEDURE start_trip(
  p_trip_id UUID,
  p_vehicle_id UUID,
  p_current_mileage INT,
  OUT id UUID,
  OUT status VARCHAR,
  OUT start_time TIMESTAMP
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_trip_vehicle_id UUID;
  v_trip_driver_id UUID;
  v_trip_start_km INT;
  v_driver_active BOOLEAN;
  v_vehicle_status "VehicleStatus";
  v_vehicle_mileage INT;
  v_start_time TIMESTAMP;
BEGIN
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle is required';
  END IF;

  -- A viagem precisa existir e estar PLANNED
  SELECT t.fk_vehicle_id, t.fk_driver_id, t.start_km
  INTO v_trip_vehicle_id, v_trip_driver_id, v_trip_start_km
  FROM trips t
  WHERE t.id_trip = p_trip_id AND t.status = 'PLANNED'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found or not in PLANNED status';
  END IF;

  -- O veículo informado precisa ser o mesmo da viagem
  IF v_trip_vehicle_id <> p_vehicle_id THEN
    RAISE EXCEPTION 'Trip does not belong to the informed vehicle';
  END IF;

  -- O motorista da viagem precisa continuar ativo
  SELECT d.is_active INTO v_driver_active FROM drivers d WHERE d.id_driver = v_trip_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  IF NOT v_driver_active THEN
    RAISE EXCEPTION 'Driver is not active';
  END IF;

  -- Confere o veículo de novo (segunda camada de defesa)
  SELECT v.status, v.current_mileage INTO v_vehicle_status, v_vehicle_mileage
  FROM vehicles v
  WHERE v.id_vehicle = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF v_vehicle_status = 'IN_MAINTENANCE' THEN
    RAISE EXCEPTION 'Vehicle is under maintenance';
  END IF;

  IF v_vehicle_status = 'OUT_OF_SERVICE' THEN
    RAISE EXCEPTION 'Vehicle is out of service';
  END IF;

  -- A quilometragem atual não pode ser menor que a do veículo nem a inicial da viagem
  IF p_current_mileage IS NULL OR p_current_mileage < v_vehicle_mileage THEN
    RAISE EXCEPTION 'Current mileage cannot be less than vehicle current mileage (%)', v_vehicle_mileage;
  END IF;

  IF p_current_mileage > 10000000 THEN
    RAISE EXCEPTION 'Current mileage exceeds the maximum allowed (10000000)';
  END IF;

  IF p_current_mileage < v_trip_start_km THEN
    RAISE EXCEPTION 'Current mileage cannot be less than start_km';
  END IF;

  UPDATE trips
  SET status = 'IN_PROGRESS', start_time = NOW(), updated_at = NOW()
  WHERE id_trip = p_trip_id
  RETURNING trips.start_time INTO v_start_time;

  -- Veículo em uso (se estava AVAILABLE, regulariza) e com a quilometragem nova
  UPDATE vehicles
  SET status = 'IN_USE', current_mileage = p_current_mileage, updated_at = NOW()
  WHERE id_vehicle = p_vehicle_id;

  id := p_trip_id;
  status := 'IN_PROGRESS';
  start_time := v_start_time;
END;
$$;

-- end_trip: só ganha o teto de km com mensagem própria
CREATE OR REPLACE PROCEDURE end_trip(
  p_trip_id UUID,
  p_end_mileage INT,
  p_end_location TEXT,
  OUT id UUID,
  OUT status VARCHAR,
  OUT total_km INT,
  OUT start_time TIMESTAMP,
  OUT end_time TIMESTAMP,
  OUT vehicle_mileage INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_start_km INT;
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_vehicle_id UUID;
  v_vehicle_mileage INT;
  v_end_location TEXT;
BEGIN
  v_end_location := btrim(p_end_location);
  IF v_end_location IS NULL OR v_end_location = '' THEN
    RAISE EXCEPTION 'End location cannot be empty';
  END IF;

  IF char_length(v_end_location) > 255 THEN
    RAISE EXCEPTION 'Location cannot be longer than 255 characters';
  END IF;

  -- A viagem precisa existir e estar IN_PROGRESS
  SELECT t.start_km, t.start_time, t.fk_vehicle_id
  INTO v_start_km, v_start_time, v_vehicle_id
  FROM trips t
  WHERE t.id_trip = p_trip_id AND t.status = 'IN_PROGRESS'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found or not in IN_PROGRESS status';
  END IF;

  SELECT v.current_mileage INTO v_vehicle_mileage
  FROM vehicles v
  WHERE v.id_vehicle = v_vehicle_id
  FOR UPDATE;

  -- A quilometragem final não pode ser menor que a inicial nem que a do veículo
  IF p_end_mileage IS NULL OR p_end_mileage < v_start_km THEN
    RAISE EXCEPTION 'End mileage cannot be less than start mileage';
  END IF;

  IF p_end_mileage > 10000000 THEN
    RAISE EXCEPTION 'End mileage exceeds the maximum allowed (10000000)';
  END IF;

  IF p_end_mileage < v_vehicle_mileage THEN
    RAISE EXCEPTION 'End mileage cannot be less than vehicle current mileage (%)', v_vehicle_mileage;
  END IF;

  -- Hora real em milissegundos (igual à coluna); precisa ser depois do início
  v_end_time := date_trunc('milliseconds', clock_timestamp());
  IF v_end_time <= v_start_time THEN
    RAISE EXCEPTION 'End time must be after start time';
  END IF;

  UPDATE trips
  SET status = 'COMPLETED', end_km = p_end_mileage, end_location = v_end_location,
      end_time = v_end_time, updated_at = NOW()
  WHERE id_trip = p_trip_id;

  -- Quilometragem do veículo; a liberação (IN_USE -> AVAILABLE) é feita pelo trigger
  UPDATE vehicles
  SET current_mileage = p_end_mileage, updated_at = NOW()
  WHERE id_vehicle = v_vehicle_id;

  UPDATE vehicles
  SET status = 'AVAILABLE', updated_at = NOW()
  WHERE id_vehicle = v_vehicle_id AND status = 'IN_USE';

  id := p_trip_id;
  status := 'COMPLETED';
  total_km := p_end_mileage - v_start_km;
  start_time := v_start_time;
  end_time := v_end_time;
  vehicle_mileage := p_end_mileage;
END;
$$;

-- register_refueling: arredonda antes de calcular e valida faixas
CREATE OR REPLACE PROCEDURE register_refueling(
  p_vehicle_id UUID,
  p_driver_id UUID,
  p_mileage INT,
  p_liters DECIMAL,
  p_cost_per_liter DECIMAL,
  p_fuel_type VARCHAR,
  p_registered_by UUID,
  OUT id UUID,
  OUT total_cost DECIMAL,
  OUT vehicle_mileage INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_vehicle_status "VehicleStatus";
  v_vehicle_mileage INT;
  v_driver_active BOOLEAN;
  v_trip_driver_id UUID;
  v_liters DECIMAL;
  v_cost DECIMAL;
  v_total_cost DECIMAL;
BEGIN
  IF p_registered_by IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id_user = p_registered_by) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Números precisam ser positivos e caber nas colunas
  IF p_mileage IS NULL OR p_mileage <= 0 THEN
    RAISE EXCEPTION 'Mileage must be greater than zero';
  END IF;

  IF p_mileage > 10000000 THEN
    RAISE EXCEPTION 'Mileage exceeds the maximum allowed (10000000)';
  END IF;

  -- Arredonda antes de calcular: os valores gravados batem com o CHECK do total
  IF p_liters IS NULL OR ROUND(p_liters, 2) <= 0 THEN
    RAISE EXCEPTION 'Liters must be greater than zero';
  END IF;
  v_liters := ROUND(p_liters, 2);

  IF p_cost_per_liter IS NULL OR ROUND(p_cost_per_liter, 4) <= 0 THEN
    RAISE EXCEPTION 'Cost per liter must be greater than zero';
  END IF;
  v_cost := ROUND(p_cost_per_liter, 4);

  IF v_liters > 99999999.99 THEN
    RAISE EXCEPTION 'Liters exceeds the maximum allowed (99999999.99)';
  END IF;

  IF v_cost > 999999.9999 THEN
    RAISE EXCEPTION 'Cost per liter exceeds the maximum allowed (999999.9999)';
  END IF;

  v_total_cost := ROUND(v_liters * v_cost, 2);
  IF v_total_cost > 9999999999.99 THEN
    RAISE EXCEPTION 'Total cost exceeds the maximum allowed (9999999999.99)';
  END IF;

  IF p_fuel_type IS NULL OR p_fuel_type NOT IN ('DIESEL', 'GASOLINE', 'ETHANOL', 'HYBRID') THEN
    RAISE EXCEPTION 'Invalid fuel type (use DIESEL, GASOLINE, ETHANOL or HYBRID)';
  END IF;

  -- Veículo precisa existir e estar ativo (fora de serviço = inativo)
  SELECT v.status, v.current_mileage INTO v_vehicle_status, v_vehicle_mileage
  FROM vehicles v
  WHERE v.id_vehicle = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF v_vehicle_status = 'OUT_OF_SERVICE' THEN
    RAISE EXCEPTION 'Vehicle is out of service';
  END IF;

  -- Motorista precisa existir e estar ativo
  SELECT d.is_active INTO v_driver_active FROM drivers d WHERE d.id_driver = p_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  IF NOT v_driver_active THEN
    RAISE EXCEPTION 'Driver is not active';
  END IF;

  -- Se o veículo está em viagem, quem abastece é o motorista da viagem
  SELECT t.fk_driver_id INTO v_trip_driver_id
  FROM trips t
  WHERE t.fk_vehicle_id = p_vehicle_id AND t.status = 'IN_PROGRESS';
  IF FOUND AND v_trip_driver_id <> p_driver_id THEN
    RAISE EXCEPTION 'Driver does not match the active trip of the vehicle';
  END IF;

  -- A quilometragem não pode andar para trás
  IF p_mileage < v_vehicle_mileage THEN
    RAISE EXCEPTION 'Mileage cannot be less than vehicle current mileage (%)', v_vehicle_mileage;
  END IF;

  INSERT INTO refuelings (id_refueling, fk_vehicle_id, fk_driver_id, mileage, liters_added, cost_per_liter, total_cost, fuel_type, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_vehicle_id, p_driver_id, p_mileage, v_liters, v_cost, v_total_cost, p_fuel_type::"FuelType", p_registered_by, NOW())
  RETURNING refuelings.id_refueling INTO id;

  UPDATE vehicles
  SET current_mileage = p_mileage, updated_at = NOW()
  WHERE id_vehicle = p_vehicle_id;

  total_cost := v_total_cost;
  vehicle_mileage := p_mileage;
END;
$$;

-- register_incident: trava a linha da viagem enquanto grava
CREATE OR REPLACE PROCEDURE register_incident(
  p_trip_id UUID,
  p_vehicle_id UUID,
  p_driver_id UUID,
  p_incident_type VARCHAR,
  p_severity VARCHAR,
  p_description TEXT,
  p_photo_url TEXT,
  p_photo_key TEXT,
  p_registered_by UUID,
  OUT id UUID,
  OUT status VARCHAR,
  OUT created_at TIMESTAMP
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_vehicle_status "VehicleStatus";
  v_driver_active BOOLEAN;
  v_trip_vehicle_id UUID;
  v_trip_driver_id UUID;
  v_trip_status "TripStatus";
  v_description TEXT;
BEGIN
  IF p_registered_by IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id_user = p_registered_by) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Enums, descrição e foto
  IF p_incident_type IS NULL OR p_incident_type NOT IN ('ACCIDENT', 'MECHANICAL_FAILURE', 'OTHER') THEN
    RAISE EXCEPTION 'Invalid incident type (use ACCIDENT, MECHANICAL_FAILURE or OTHER)';
  END IF;

  IF p_severity IS NULL OR p_severity NOT IN ('LOW', 'MEDIUM', 'HIGH') THEN
    RAISE EXCEPTION 'Invalid severity (use LOW, MEDIUM or HIGH)';
  END IF;

  v_description := btrim(p_description);
  IF v_description IS NULL OR v_description = '' THEN
    RAISE EXCEPTION 'Description cannot be empty';
  END IF;

  IF char_length(v_description) > 1000 THEN
    RAISE EXCEPTION 'Description cannot be longer than 1000 characters';
  END IF;

  IF p_photo_url IS NOT NULL THEN
    IF p_photo_url !~* '^https?://.+' THEN
      RAISE EXCEPTION 'Photo URL must start with http:// or https://';
    END IF;

    IF char_length(p_photo_url) > 500 THEN
      RAISE EXCEPTION 'Photo URL cannot be longer than 500 characters';
    END IF;
  END IF;

  IF p_photo_key IS NOT NULL AND char_length(p_photo_key) > 255 THEN
    RAISE EXCEPTION 'Photo key cannot be longer than 255 characters';
  END IF;

  -- Veículo precisa existir e estar ativo (fora de serviço = inativo)
  SELECT v.status INTO v_vehicle_status FROM vehicles v WHERE v.id_vehicle = p_vehicle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF v_vehicle_status = 'OUT_OF_SERVICE' THEN
    RAISE EXCEPTION 'Vehicle is out of service';
  END IF;

  -- Motorista precisa existir e estar ativo
  SELECT d.is_active INTO v_driver_active FROM drivers d WHERE d.id_driver = p_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  IF NOT v_driver_active THEN
    RAISE EXCEPTION 'Driver is not active';
  END IF;

  -- A viagem é opcional, mas se vier: existe, é do veículo, do motorista e está em andamento.
  -- FOR UPDATE: espera outra transação que esteja concluindo a viagem.
  IF p_trip_id IS NOT NULL THEN
    SELECT t.fk_vehicle_id, t.fk_driver_id, t.status
    INTO v_trip_vehicle_id, v_trip_driver_id, v_trip_status
    FROM trips t
    WHERE t.id_trip = p_trip_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Trip not found';
    END IF;

    IF v_trip_vehicle_id <> p_vehicle_id THEN
      RAISE EXCEPTION 'Trip does not belong to the informed vehicle';
    END IF;

    IF v_trip_driver_id <> p_driver_id THEN
      RAISE EXCEPTION 'Driver does not match the trip driver';
    END IF;

    IF v_trip_status <> 'IN_PROGRESS' THEN
      RAISE EXCEPTION 'Trip is not in IN_PROGRESS status';
    END IF;
  END IF;

  INSERT INTO incidents (id_incident, fk_trip_id, fk_vehicle_id, fk_driver_id, type, severity, status, description, photo_url, photo_key, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_trip_id, p_vehicle_id, p_driver_id, p_incident_type::"IncidentType", p_severity::"Severity", 'REPORTED', v_description, p_photo_url, p_photo_key, p_registered_by, NOW())
  RETURNING incidents.id_incident, incidents.created_at INTO id, created_at;

  status := 'REPORTED';
END;
$$;

-- ============================================================
-- 8) Permissões: tira o EXECUTE de PUBLIC (o app hoje usa o dono do banco)
-- ============================================================
REVOKE ALL ON PROCEDURE create_trip(UUID, UUID, INT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON PROCEDURE start_trip(UUID, UUID, INT) FROM PUBLIC;
REVOKE ALL ON PROCEDURE end_trip(UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON PROCEDURE cancel_trip(UUID) FROM PUBLIC;
REVOKE ALL ON PROCEDURE register_refueling(UUID, UUID, INT, DECIMAL, DECIMAL, VARCHAR, UUID) FROM PUBLIC;
REVOKE ALL ON PROCEDURE register_incident(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION fn_prevent_vehicle_in_maintenance_from_trip() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_prevent_driver_double_active_trip() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_prevent_vehicle_double_active_trip() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_validate_trip_kilometers() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_audit_trip_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_audit_refueling_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_audit_incident_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_sync_vehicle_from_trip() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_protect_vehicle_status_and_mileage() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_block_vehicle_in_use_on_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_sync_vehicle_mileage_from_refueling() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_block_audit_logs_changes() FROM PUBLIC;
