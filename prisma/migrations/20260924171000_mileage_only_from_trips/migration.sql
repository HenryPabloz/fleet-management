-- O hodômetro do veículo nunca vem do cliente: só cresce pelas viagens (end_trip soma os km rodados).
-- start_trip e register_refueling deixam de receber quilometragem; abastecimento não mexe mais no hodômetro.

DROP TRIGGER IF EXISTS trg_sync_vehicle_mileage_from_refueling ON refuelings;
DROP FUNCTION IF EXISTS public.fn_sync_vehicle_mileage_from_refueling();

DROP PROCEDURE IF EXISTS public.start_trip(UUID, UUID, INT);
DROP PROCEDURE IF EXISTS public.end_trip(UUID, INT, TEXT);
DROP PROCEDURE IF EXISTS public.register_refueling(UUID, UUID, INT, DECIMAL, DECIMAL, VARCHAR, UUID);

CREATE PROCEDURE public.start_trip(IN p_trip_id uuid, IN p_vehicle_id uuid, OUT id uuid, OUT status character varying, OUT start_time timestamp without time zone)
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

  -- start_km = quilometragem atual do veículo; o hodômetro não muda no start
  UPDATE trips
  SET status = 'IN_PROGRESS', start_time = NOW(), start_km = v_vehicle_mileage, updated_at = NOW()
  WHERE id_trip = p_trip_id
  RETURNING trips.start_time INTO v_start_time;

  -- Veículo em uso (se estava AVAILABLE, regulariza)
  UPDATE vehicles
  SET status = 'IN_USE', updated_at = NOW()
  WHERE id_vehicle = p_vehicle_id;

  id := p_trip_id;
  status := 'IN_PROGRESS';
  start_time := v_start_time;
END;
$procedure$;

CREATE PROCEDURE public.end_trip(IN p_trip_id uuid, IN p_end_km integer, IN p_end_location text, OUT id uuid, OUT status character varying, OUT total_km integer, OUT start_time timestamp without time zone, OUT end_time timestamp without time zone, OUT vehicle_mileage integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $procedure$
#variable_conflict use_column
DECLARE
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_vehicle_id UUID;
  v_vehicle_mileage INT;
  v_new_mileage BIGINT;
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
  SELECT t.start_time, t.fk_vehicle_id
  INTO v_start_time, v_vehicle_id
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

  -- p_end_km = km rodados na viagem (não é leitura de hodômetro)
  IF p_end_km IS NULL OR p_end_km <= 0 THEN
    RAISE EXCEPTION 'End km must be greater than zero';
  END IF;

  IF p_end_km > 100000 THEN
    RAISE EXCEPTION 'End km exceeds the maximum allowed (100000)';
  END IF;

  v_new_mileage := v_vehicle_mileage::BIGINT + p_end_km;
  IF v_new_mileage > 10000000 THEN
    RAISE EXCEPTION 'End mileage exceeds the maximum allowed (10000000)';
  END IF;

  -- Hora real em milissegundos (igual à coluna); precisa ser depois do início
  v_end_time := date_trunc('milliseconds', clock_timestamp());
  IF v_end_time <= v_start_time THEN
    RAISE EXCEPTION 'End time must be after start time';
  END IF;

  -- end_km continua sendo o hodômetro final absoluto
  UPDATE trips
  SET status = 'COMPLETED', end_km = v_new_mileage, end_location = v_end_location,
      end_time = v_end_time, updated_at = NOW()
  WHERE id_trip = p_trip_id;

  -- Soma os km rodados ao veículo e libera (IN_USE -> AVAILABLE)
  UPDATE vehicles
  SET current_mileage = v_new_mileage, updated_at = NOW()
  WHERE id_vehicle = v_vehicle_id;

  UPDATE vehicles
  SET status = 'AVAILABLE', updated_at = NOW()
  WHERE id_vehicle = v_vehicle_id AND status = 'IN_USE';

  id := p_trip_id;
  status := 'COMPLETED';
  total_km := p_end_km;
  start_time := v_start_time;
  end_time := v_end_time;
  vehicle_mileage := v_new_mileage;
END;
$procedure$;

CREATE PROCEDURE public.register_refueling(IN p_vehicle_id uuid, IN p_driver_id uuid, IN p_liters numeric, IN p_cost_per_liter numeric, IN p_fuel_type character varying, IN p_registered_by uuid, OUT id uuid, OUT total_cost numeric, OUT vehicle_mileage integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $procedure$
#variable_conflict use_column
DECLARE
  v_vehicle_status "VehicleStatus";
  v_vehicle_active BOOLEAN;
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

  -- mileage = foto do hodômetro atual; o hodômetro do veículo não muda
  INSERT INTO refuelings (id_refueling, fk_vehicle_id, fk_driver_id, mileage, liters_added, cost_per_liter, total_cost, fuel_type, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_vehicle_id, p_driver_id, v_vehicle_mileage, v_liters, v_cost, v_total_cost, p_fuel_type::"FuelType", p_registered_by, NOW())
  RETURNING refuelings.id_refueling INTO id;

  total_cost := v_total_cost;
  vehicle_mileage := v_vehicle_mileage;
END;
$procedure$;

REVOKE ALL ON PROCEDURE start_trip(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON PROCEDURE end_trip(UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON PROCEDURE register_refueling(UUID, UUID, DECIMAL, DECIMAL, VARCHAR, UUID) FROM PUBLIC;
