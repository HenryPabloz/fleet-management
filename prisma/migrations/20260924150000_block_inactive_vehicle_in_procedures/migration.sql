-- Veículo inativo não pode ser usado: 'Vehicle is not active'.

CREATE OR REPLACE PROCEDURE public.create_trip(IN p_driver_id uuid, IN p_vehicle_id uuid, IN p_start_km integer, IN p_start_location text, IN p_end_location text, IN p_created_by uuid, OUT id uuid, OUT status character varying)
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
$procedure$

;

CREATE OR REPLACE PROCEDURE public.start_trip(IN p_trip_id uuid, IN p_vehicle_id uuid, IN p_current_mileage integer, OUT id uuid, OUT status character varying, OUT start_time timestamp without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $procedure$
#variable_conflict use_column
DECLARE
  v_trip_vehicle_id UUID;
  v_trip_driver_id UUID;
  v_trip_start_km INT;
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
$procedure$

;

CREATE OR REPLACE PROCEDURE public.register_refueling(IN p_vehicle_id uuid, IN p_driver_id uuid, IN p_mileage integer, IN p_liters numeric, IN p_cost_per_liter numeric, IN p_fuel_type character varying, IN p_registered_by uuid, OUT id uuid, OUT total_cost numeric, OUT vehicle_mileage integer)
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
$procedure$

;

CREATE OR REPLACE PROCEDURE public.register_incident(IN p_trip_id uuid, IN p_vehicle_id uuid, IN p_driver_id uuid, IN p_incident_type character varying, IN p_severity character varying, IN p_description text, IN p_photo_url text, IN p_photo_key text, IN p_registered_by uuid, OUT id uuid, OUT status character varying, OUT created_at timestamp without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $procedure$
#variable_conflict use_column
DECLARE
  v_vehicle_status "VehicleStatus";
  v_vehicle_active BOOLEAN;
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
  SELECT v.status, v.is_active INTO v_vehicle_status, v_vehicle_active FROM vehicles v WHERE v.id_vehicle = p_vehicle_id;
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
$procedure$

;
