-- Correção de gaps:
--  * create_trip passa a colocar o veículo em IN_USE (veículo reservado para a viagem).
--  * start_trip passa a receber o veículo e confere se ele é o da viagem.
--  * register_incident passa a validar a viagem (quando informada).

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
  v_vehicle_status "VehicleStatus";
BEGIN
  -- Motorista precisa existir
  IF NOT EXISTS (SELECT 1 FROM drivers WHERE id_driver = p_driver_id) THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  -- Veículo precisa existir (e já guardamos o status dele)
  SELECT v.status INTO v_vehicle_status FROM vehicles v WHERE v.id_vehicle = p_vehicle_id;
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
-- start_trip (nova assinatura: recebe também o veículo)
-- ============================================================
DROP PROCEDURE IF EXISTS start_trip(UUID, INT);

CREATE OR REPLACE PROCEDURE start_trip(
  p_trip_id UUID,
  p_vehicle_id UUID,
  p_current_mileage INT,
  OUT id UUID,
  OUT status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_trip_vehicle_id UUID;
  v_vehicle_status "VehicleStatus";
BEGIN
  -- A viagem precisa existir e estar PLANNED
  SELECT t.fk_vehicle_id INTO v_trip_vehicle_id
  FROM trips t
  WHERE t.id_trip = p_trip_id AND t.status = 'PLANNED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found or not in PLANNED status';
  END IF;

  -- O veículo informado precisa ser o mesmo da viagem
  IF v_trip_vehicle_id <> p_vehicle_id THEN
    RAISE EXCEPTION 'Trip does not belong to the informed vehicle';
  END IF;

  -- O veículo precisa continuar reservado (IN_USE). Se foi para manutenção, não parte.
  SELECT v.status INTO v_vehicle_status FROM vehicles v WHERE v.id_vehicle = p_vehicle_id;
  IF v_vehicle_status <> 'IN_USE' THEN
    RAISE EXCEPTION 'Vehicle is not reserved for this trip (status: %)', v_vehicle_status;
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
DECLARE
  v_trip_vehicle_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id_vehicle = p_vehicle_id) THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM drivers WHERE id_driver = p_driver_id) THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  -- A viagem é opcional, mas se vier precisa existir e ser do veículo informado
  IF p_trip_id IS NOT NULL THEN
    SELECT t.fk_vehicle_id INTO v_trip_vehicle_id FROM trips t WHERE t.id_trip = p_trip_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Trip not found';
    END IF;

    IF v_trip_vehicle_id <> p_vehicle_id THEN
      RAISE EXCEPTION 'Trip does not belong to the informed vehicle';
    END IF;
  END IF;

  INSERT INTO incidents (id_incident, fk_trip_id, fk_vehicle_id, fk_driver_id, type, severity, status, description, photo_url, photo_key, fk_user_id, updated_at)
  VALUES (gen_random_uuid(), p_trip_id, p_vehicle_id, p_driver_id, p_incident_type::"IncidentType", p_severity::"Severity", 'REPORTED', p_description, p_photo_url, p_photo_key, p_registered_by, NOW())
  RETURNING incidents.id_incident INTO id;

  status := 'REPORTED';
END;
$$;
