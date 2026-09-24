-- create_trip deixa de receber start_km: usa a quilometragem atual do veículo (provisória).
-- start_trip grava a leitura real do hodômetro como start_km definitivo.

DROP PROCEDURE IF EXISTS public.create_trip(UUID, UUID, INT, TEXT, TEXT, UUID);

CREATE PROCEDURE public.create_trip(
  IN p_driver_id uuid, IN p_vehicle_id uuid, IN p_start_location text, IN p_end_location text,
  IN p_created_by uuid, OUT id uuid, OUT status character varying)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $procedure$
#variable_conflict use_column
DECLARE
  v_creator_active BOOLEAN;
  v_driver_active BOOLEAN;
  v_driver_license_expiry DATE;
  v_driver_user_active BOOLEAN;
  v_vehicle_status "VehicleStatus";
  v_vehicle_active BOOLEAN;
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
  SELECT v.status, v.current_mileage, v.is_active INTO v_vehicle_status, v_vehicle_mileage, v_vehicle_active
  FROM vehicles v
  WHERE v.id_vehicle = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF NOT v_vehicle_active THEN
    RAISE EXCEPTION 'Vehicle is not active';
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

  -- start_km provisório = quilometragem atual do veículo (o start_trip grava o real)
  INSERT INTO trips (id_trip, fk_driver_id, fk_vehicle_id, status, start_km, start_location, end_location, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_driver_id, p_vehicle_id, 'PLANNED', v_vehicle_mileage, v_start_location, v_end_location, p_created_by, NOW())
  RETURNING trips.id_trip INTO id;

  -- O trigger de sincronização já marca IN_USE; aqui só garantimos (não muda nada se já estiver)
  UPDATE vehicles
  SET status = 'IN_USE', updated_at = NOW()
  WHERE id_vehicle = p_vehicle_id;

  status := 'PLANNED';
END;
$procedure$;

REVOKE ALL ON PROCEDURE create_trip(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC;

-- start_trip: a leitura informada vira o start_km definitivo.
-- A checagem "menor que start_km" foi removida: start_km <= km do veículo, então a checagem do veículo já cobre.
CREATE OR REPLACE PROCEDURE public.start_trip(IN p_trip_id uuid, IN p_vehicle_id uuid, IN p_current_mileage integer, OUT id uuid, OUT status character varying, OUT start_time timestamp without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $procedure$
#variable_conflict use_column
DECLARE
  v_trip_vehicle_id UUID;
  v_trip_driver_id UUID;
  v_driver_active BOOLEAN;
  v_vehicle_status "VehicleStatus";
  v_vehicle_active BOOLEAN;
  v_vehicle_mileage INT;
  v_start_time TIMESTAMP;
BEGIN
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle is required';
  END IF;

  -- A viagem precisa existir e estar PLANNED
  SELECT t.fk_vehicle_id, t.fk_driver_id
  INTO v_trip_vehicle_id, v_trip_driver_id
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
  SELECT v.status, v.current_mileage, v.is_active INTO v_vehicle_status, v_vehicle_mileage, v_vehicle_active
  FROM vehicles v
  WHERE v.id_vehicle = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF NOT v_vehicle_active THEN
    RAISE EXCEPTION 'Vehicle is not active';
  END IF;

  IF v_vehicle_status = 'IN_MAINTENANCE' THEN
    RAISE EXCEPTION 'Vehicle is under maintenance';
  END IF;

  IF v_vehicle_status = 'OUT_OF_SERVICE' THEN
    RAISE EXCEPTION 'Vehicle is out of service';
  END IF;

  -- A leitura do hodômetro não pode ser menor que a do veículo
  IF p_current_mileage IS NULL OR p_current_mileage < v_vehicle_mileage THEN
    RAISE EXCEPTION 'Current mileage cannot be less than vehicle current mileage (%)', v_vehicle_mileage;
  END IF;

  IF p_current_mileage > 10000000 THEN
    RAISE EXCEPTION 'Current mileage exceeds the maximum allowed (10000000)';
  END IF;

  UPDATE trips
  SET status = 'IN_PROGRESS', start_time = NOW(), start_km = p_current_mileage, updated_at = NOW()
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
$procedure$;
