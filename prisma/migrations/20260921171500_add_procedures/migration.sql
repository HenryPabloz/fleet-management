-- Procedures da seção 5.2 do DESIGN.
-- Os resultados voltam pelos parâmetros OUT: CALL nome(..., NULL, NULL) devolve uma linha.
-- "#variable_conflict use_column": se um nome for igual ao de uma coluna (ex: status), vale a coluna.

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
BEGIN
  -- Motorista precisa existir
  IF NOT EXISTS (SELECT 1 FROM drivers WHERE id_driver = p_driver_id) THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  -- Veículo precisa existir
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id_vehicle = p_vehicle_id) THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  -- Veículo em manutenção não pode viajar
  IF (SELECT v.status FROM vehicles v WHERE v.id_vehicle = p_vehicle_id) = 'IN_MAINTENANCE' THEN
    RAISE EXCEPTION 'Vehicle is under maintenance';
  END IF;

  INSERT INTO trips (id_trip, fk_driver_id, fk_vehicle_id, status, start_km, start_location, end_location, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_driver_id, p_vehicle_id, 'PLANNED', p_start_km, p_start_location, p_end_location, p_created_by, NOW())
  RETURNING trips.id_trip INTO id;

  status := 'PLANNED';
END;
$$;

-- ============================================================
-- start_trip
-- ============================================================
CREATE OR REPLACE PROCEDURE start_trip(
  p_trip_id UUID,
  p_current_mileage INT,
  OUT id UUID,
  OUT status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  -- A viagem precisa existir e estar PLANNED
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id_trip = p_trip_id AND status = 'PLANNED') THEN
    RAISE EXCEPTION 'Trip not found or not in PLANNED status';
  END IF;

  -- A quilometragem atual não pode ser menor que a inicial
  IF p_current_mileage < (SELECT t.start_km FROM trips t WHERE t.id_trip = p_trip_id) THEN
    RAISE EXCEPTION 'Current mileage cannot be less than start_km';
  END IF;

  UPDATE trips
  SET status = 'IN_PROGRESS', start_time = NOW(), updated_at = NOW()
  WHERE id_trip = p_trip_id;

  id := p_trip_id;
  status := 'IN_PROGRESS';
END;
$$;

-- ============================================================
-- end_trip
-- ============================================================
CREATE OR REPLACE PROCEDURE end_trip(
  p_trip_id UUID,
  p_end_mileage INT,
  p_end_location TEXT,
  OUT id UUID,
  OUT status VARCHAR,
  OUT total_km INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_start_km INT;
BEGIN
  -- A viagem precisa existir e estar IN_PROGRESS
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id_trip = p_trip_id AND status = 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Trip not found or not in IN_PROGRESS status';
  END IF;

  SELECT t.start_km INTO v_start_km FROM trips t WHERE t.id_trip = p_trip_id;

  -- A quilometragem final não pode ser menor que a inicial
  IF p_end_mileage < v_start_km THEN
    RAISE EXCEPTION 'End mileage cannot be less than start mileage';
  END IF;

  UPDATE trips
  SET status = 'COMPLETED', end_km = p_end_mileage, end_location = p_end_location,
      end_time = NOW(), updated_at = NOW()
  WHERE id_trip = p_trip_id;

  id := p_trip_id;
  status := 'COMPLETED';
  total_km := p_end_mileage - v_start_km;
END;
$$;

-- ============================================================
-- register_refueling
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
  OUT total_cost DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id_vehicle = p_vehicle_id) THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM drivers WHERE id_driver = p_driver_id) THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  -- Arredonda em 2 casas, igual à coluna total_cost (12,2)
  total_cost := ROUND(p_liters * p_cost_per_liter, 2);

  INSERT INTO refuelings (id_refueling, fk_vehicle_id, fk_driver_id, mileage, liters_added, cost_per_liter, total_cost, fuel_type, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_vehicle_id, p_driver_id, p_mileage, p_liters, p_cost_per_liter, total_cost, p_fuel_type::"FuelType", p_registered_by, NOW())
  RETURNING refuelings.id_refueling INTO id;
END;
$$;

-- ============================================================
-- register_incident
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
  OUT status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id_vehicle = p_vehicle_id) THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM drivers WHERE id_driver = p_driver_id) THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  INSERT INTO incidents (id_incident, fk_trip_id, fk_vehicle_id, fk_driver_id, type, severity, status, description, photo_url, photo_key, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_trip_id, p_vehicle_id, p_driver_id, p_incident_type::"IncidentType", p_severity::"Severity", 'REPORTED', p_description, p_photo_url, p_photo_key, p_registered_by, NOW())
  RETURNING incidents.id_incident INTO id;

  status := 'REPORTED';
END;
$$;
