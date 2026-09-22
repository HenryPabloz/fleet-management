-- Correções da rodada 1 do QA.
-- Regra única: veículo IN_USE existe somente enquanto ele tem viagem ativa (PLANNED/IN_PROGRESS).

-- ============================================================
-- Trigger novo: sincroniza o veículo com as viagens (INSERT, DELETE, UPDATE)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_sync_vehicle_from_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vehicle_ids UUID[];
  v_vehicle_id UUID;
BEGIN
  -- Veículos afetados: o novo e, se mudou de veículo, o antigo também
  IF TG_OP = 'INSERT' THEN
    v_vehicle_ids := ARRAY[NEW.fk_vehicle_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_vehicle_ids := ARRAY[OLD.fk_vehicle_id];
  ELSE
    v_vehicle_ids := ARRAY[NEW.fk_vehicle_id, OLD.fk_vehicle_id];
  END IF;

  -- Viagem concluída: a quilometragem final vai para o veículo (nunca diminui)
  IF TG_OP <> 'DELETE' THEN
    IF NEW.status = 'COMPLETED' AND NEW.end_km IS NOT NULL THEN
      UPDATE vehicles
      SET current_mileage = NEW.end_km, updated_at = NOW()
      WHERE id_vehicle = NEW.fk_vehicle_id AND current_mileage < NEW.end_km;
    END IF;
  END IF;

  FOREACH v_vehicle_id IN ARRAY v_vehicle_ids LOOP
    IF EXISTS (
      SELECT 1 FROM trips t
      WHERE t.fk_vehicle_id = v_vehicle_id AND t.status IN ('PLANNED', 'IN_PROGRESS')
    ) THEN
      UPDATE vehicles SET status = 'IN_USE', updated_at = NOW()
      WHERE id_vehicle = v_vehicle_id AND status = 'AVAILABLE';
    ELSE
      UPDATE vehicles SET status = 'AVAILABLE', updated_at = NOW()
      WHERE id_vehicle = v_vehicle_id AND status = 'IN_USE';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_vehicle_from_trip
AFTER INSERT OR DELETE OR UPDATE OF status, fk_vehicle_id ON trips
FOR EACH ROW
EXECUTE FUNCTION fn_sync_vehicle_from_trip();

-- ============================================================
-- Trigger novo em vehicles: protege status e quilometragem
-- ============================================================
CREATE OR REPLACE FUNCTION fn_protect_vehicle_status_and_mileage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_active_trip BOOLEAN;
BEGIN
  IF NEW.current_mileage < OLD.current_mileage THEN
    RAISE EXCEPTION 'Mileage cannot decrease';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT EXISTS (
      SELECT 1 FROM trips t
      WHERE t.fk_vehicle_id = NEW.id_vehicle AND t.status IN ('PLANNED', 'IN_PROGRESS')
    ) INTO v_has_active_trip;

    IF v_has_active_trip AND NEW.status <> 'IN_USE' THEN
      RAISE EXCEPTION 'Vehicle has an active trip: end or cancel it first';
    END IF;

    IF NOT v_has_active_trip AND NEW.status = 'IN_USE' THEN
      RAISE EXCEPTION 'IN_USE is set only by trips';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_vehicle_status_and_mileage
BEFORE UPDATE OF status, current_mileage ON vehicles
FOR EACH ROW
EXECUTE FUNCTION fn_protect_vehicle_status_and_mileage();

-- ============================================================
-- Disponibilidade do veículo: agora também ao trocar de veículo ou reativar a viagem
-- ============================================================
CREATE OR REPLACE FUNCTION fn_prevent_vehicle_in_maintenance_from_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vehicle_status "VehicleStatus";
BEGIN
  -- Em UPDATE só confere se trocou de veículo ou se a viagem estava inativa (reativação)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.fk_vehicle_id = OLD.fk_vehicle_id AND OLD.status IN ('PLANNED', 'IN_PROGRESS') THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT v.status INTO v_vehicle_status FROM vehicles v WHERE v.id_vehicle = NEW.fk_vehicle_id;

  IF v_vehicle_status IN ('IN_MAINTENANCE', 'OUT_OF_SERVICE', 'IN_USE') THEN
    RAISE EXCEPTION 'Vehicle is not available (maintenance, out of service, or already in use)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER trg_prevent_vehicle_in_maintenance_from_trip ON trips;

CREATE TRIGGER trg_prevent_vehicle_in_maintenance_from_trip
BEFORE INSERT OR UPDATE OF fk_vehicle_id, status ON trips
FOR EACH ROW
WHEN (NEW.status IN ('PLANNED', 'IN_PROGRESS'))
EXECUTE FUNCTION fn_prevent_vehicle_in_maintenance_from_trip();

-- ============================================================
-- Procedures (mesmas assinaturas: CREATE OR REPLACE)
-- ============================================================

-- create_trip: valida usuário e locais
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
  v_driver_active BOOLEAN;
  v_vehicle_status "VehicleStatus";
  v_vehicle_mileage INT;
  v_start_location TEXT;
  v_end_location TEXT;
BEGIN
  -- Usuário e locais (com trim) precisam ser válidos
  IF p_created_by IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id_user = p_created_by) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

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

  -- Motorista precisa existir e estar ativo
  SELECT d.is_active INTO v_driver_active FROM drivers d WHERE d.id_driver = p_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  IF NOT v_driver_active THEN
    RAISE EXCEPTION 'Driver is not active';
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

  -- Quilometragem inicial: não negativa e não menor que a do veículo
  IF p_start_km IS NULL OR p_start_km < 0 THEN
    RAISE EXCEPTION 'Start km cannot be negative';
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

-- end_trip: local válido e end_time truncado em milissegundos
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

-- register_refueling: usuário, arredondamento, motorista da viagem
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
  v_total_cost DECIMAL;
BEGIN
  IF p_registered_by IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id_user = p_registered_by) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Números precisam ser positivos (já considerando o arredondamento das colunas)
  IF p_mileage IS NULL OR p_mileage <= 0 THEN
    RAISE EXCEPTION 'Mileage must be greater than zero';
  END IF;

  IF p_liters IS NULL OR ROUND(p_liters, 2) <= 0 THEN
    RAISE EXCEPTION 'Liters must be greater than zero';
  END IF;

  IF p_cost_per_liter IS NULL OR ROUND(p_cost_per_liter, 4) <= 0 THEN
    RAISE EXCEPTION 'Cost per liter must be greater than zero';
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

  -- Arredonda em 2 casas, igual à coluna total_cost (12,2)
  v_total_cost := ROUND(p_liters * p_cost_per_liter, 2);

  INSERT INTO refuelings (id_refueling, fk_vehicle_id, fk_driver_id, mileage, liters_added, cost_per_liter, total_cost, fuel_type, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_vehicle_id, p_driver_id, p_mileage, p_liters, p_cost_per_liter, v_total_cost, p_fuel_type::"FuelType", p_registered_by, NOW())
  RETURNING refuelings.id_refueling INTO id;

  UPDATE vehicles
  SET current_mileage = p_mileage, updated_at = NOW()
  WHERE id_vehicle = p_vehicle_id;

  total_cost := v_total_cost;
  vehicle_mileage := p_mileage;
END;
$$;

-- register_incident: usuário e motorista da viagem
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

  -- A viagem é opcional, mas se vier: existe, é do veículo, do motorista e está em andamento
  IF p_trip_id IS NOT NULL THEN
    SELECT t.fk_vehicle_id, t.fk_driver_id, t.status
    INTO v_trip_vehicle_id, v_trip_driver_id, v_trip_status
    FROM trips t
    WHERE t.id_trip = p_trip_id;
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
