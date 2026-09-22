-- Correção de gaps:
--  * register_refueling passa a atualizar a quilometragem do veículo.
--  * end_trip passa a validar que o horário de fim é maior que o de início.

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

  -- Atualiza o veículo, sem nunca diminuir a quilometragem que ele já tem
  UPDATE vehicles
  SET current_mileage = GREATEST(current_mileage, p_mileage), updated_at = NOW()
  WHERE id_vehicle = p_vehicle_id;
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

  id := p_trip_id;
  status := 'COMPLETED';
  total_km := p_end_mileage - v_start_km;
END;
$$;
