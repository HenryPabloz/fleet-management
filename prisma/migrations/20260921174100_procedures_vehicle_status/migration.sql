-- start_trip coloca o veículo em IN_USE.
-- end_trip devolve o veículo para AVAILABLE (só se ele estiver IN_USE).

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
DECLARE
  v_vehicle_id UUID;
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
  WHERE id_trip = p_trip_id
  RETURNING trips.fk_vehicle_id INTO v_vehicle_id;

  -- O veículo passa a estar em uso
  UPDATE vehicles
  SET status = 'IN_USE', updated_at = NOW()
  WHERE id_vehicle = v_vehicle_id;

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
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_vehicle_id UUID;
BEGIN
  -- A viagem precisa existir e estar IN_PROGRESS
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id_trip = p_trip_id AND status = 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Trip not found or not in IN_PROGRESS status';
  END IF;

  SELECT t.start_km, t.start_time, t.fk_vehicle_id INTO v_start_km, v_start_time, v_vehicle_id
  FROM trips t
  WHERE t.id_trip = p_trip_id;

  -- A quilometragem final não pode ser menor que a inicial
  IF p_end_mileage < v_start_km THEN
    RAISE EXCEPTION 'End mileage cannot be less than start mileage';
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

  -- Atualiza o veículo, sem nunca diminuir a quilometragem que ele já tem
  UPDATE vehicles
  SET current_mileage = GREATEST(current_mileage, p_end_mileage), updated_at = NOW()
  WHERE id_vehicle = v_vehicle_id;

  -- Libera o veículo, mas só se ele estiver IN_USE (manutenção ou fora de serviço continuam)
  UPDATE vehicles
  SET status = 'AVAILABLE', updated_at = NOW()
  WHERE id_vehicle = v_vehicle_id AND status = 'IN_USE';

  id := p_trip_id;
  status := 'COMPLETED';
  total_km := p_end_mileage - v_start_km;
END;
$$;
