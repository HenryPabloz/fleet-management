-- Correção de todos os gaps das procedures + nova procedure cancel_trip.
-- Fluxo do veículo: AVAILABLE -> IN_USE (create_trip) -> AVAILABLE (end_trip ou cancel_trip).
-- Veículo "ativo" = status diferente de OUT_OF_SERVICE. Motorista ativo = drivers.is_active.

-- Procedures com OUT novos: apaga a assinatura antiga antes de criar a nova.
DROP PROCEDURE IF EXISTS start_trip(UUID, UUID, INT);
DROP PROCEDURE IF EXISTS end_trip(UUID, INT, TEXT);
DROP PROCEDURE IF EXISTS register_refueling(UUID, UUID, INT, DECIMAL, DECIMAL, VARCHAR, UUID);
DROP PROCEDURE IF EXISTS register_incident(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT, TEXT, UUID);

-- ============================================================
-- create_trip
-- ============================================================
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
BEGIN
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
  VALUES (gen_random_uuid(), p_driver_id, p_vehicle_id, 'PLANNED', p_start_km, p_start_location, p_end_location, p_created_by, NOW())
  RETURNING trips.id_trip INTO id;

  -- O veículo fica reservado para esta viagem
  UPDATE vehicles
  SET status = 'IN_USE', updated_at = NOW()
  WHERE id_vehicle = p_vehicle_id;

  status := 'PLANNED';
END;
$$;

-- ============================================================
-- start_trip (novo OUT: start_time)
-- ============================================================
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

-- ============================================================
-- end_trip (novos OUT: start_time, end_time, vehicle_mileage)
-- ============================================================
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
BEGIN
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

  -- O horário de fim precisa ser depois do início (clock_timestamp = hora real neste instante)
  v_end_time := clock_timestamp();
  IF v_end_time <= v_start_time THEN
    RAISE EXCEPTION 'End time must be after start time';
  END IF;

  UPDATE trips
  SET status = 'COMPLETED', end_km = p_end_mileage, end_location = p_end_location,
      end_time = v_end_time, updated_at = NOW()
  WHERE id_trip = p_trip_id;

  -- Quilometragem do veículo atualizada; libera só se estiver IN_USE (manutenção continua)
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

-- ============================================================
-- cancel_trip (nova): cancela e nunca deixa o veículo preso em IN_USE
-- ============================================================
CREATE OR REPLACE PROCEDURE cancel_trip(
  p_trip_id UUID,
  OUT id UUID,
  OUT status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_trip_status "TripStatus";
  v_vehicle_id UUID;
BEGIN
  SELECT t.status, t.fk_vehicle_id INTO v_trip_status, v_vehicle_id
  FROM trips t
  WHERE t.id_trip = p_trip_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;

  -- Só viagem PLANNED ou IN_PROGRESS pode ser cancelada
  IF v_trip_status NOT IN ('PLANNED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Trip cannot be cancelled (status: %)', v_trip_status;
  END IF;

  UPDATE trips
  SET status = 'CANCELLED', updated_at = NOW()
  WHERE id_trip = p_trip_id;

  -- Libera o veículo só se estiver IN_USE e sem outra viagem ativa dele
  UPDATE vehicles
  SET status = 'AVAILABLE', updated_at = NOW()
  WHERE id_vehicle = v_vehicle_id
    AND status = 'IN_USE'
    AND NOT EXISTS (
      SELECT 1 FROM trips t
      WHERE t.fk_vehicle_id = v_vehicle_id AND t.status IN ('PLANNED', 'IN_PROGRESS')
    );

  id := p_trip_id;
  status := 'CANCELLED';
END;
$$;

-- ============================================================
-- register_refueling (novo OUT: vehicle_mileage)
-- ============================================================
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
  v_total_cost DECIMAL;
BEGIN
  -- Números precisam ser positivos
  IF p_mileage IS NULL OR p_mileage <= 0 THEN
    RAISE EXCEPTION 'Mileage must be greater than zero';
  END IF;

  IF p_liters IS NULL OR p_liters <= 0 THEN
    RAISE EXCEPTION 'Liters must be greater than zero';
  END IF;

  IF p_cost_per_liter IS NULL OR p_cost_per_liter <= 0 THEN
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

-- ============================================================
-- register_incident (novo OUT: created_at)
-- ============================================================
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
  v_trip_status "TripStatus";
  v_description TEXT;
BEGIN
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

  -- A viagem é opcional, mas se vier: existe, é do veículo e está em andamento
  IF p_trip_id IS NOT NULL THEN
    SELECT t.fk_vehicle_id, t.status INTO v_trip_vehicle_id, v_trip_status
    FROM trips t
    WHERE t.id_trip = p_trip_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Trip not found';
    END IF;

    IF v_trip_vehicle_id <> p_vehicle_id THEN
      RAISE EXCEPTION 'Trip does not belong to the informed vehicle';
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
