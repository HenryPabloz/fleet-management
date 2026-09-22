-- end_trip agora também atualiza a quilometragem atual do veículo.

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
  v_vehicle_id UUID;
BEGIN
  -- A viagem precisa existir e estar IN_PROGRESS
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id_trip = p_trip_id AND status = 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Trip not found or not in IN_PROGRESS status';
  END IF;

  SELECT t.start_km, t.fk_vehicle_id INTO v_start_km, v_vehicle_id
  FROM trips t
  WHERE t.id_trip = p_trip_id;

  -- A quilometragem final não pode ser menor que a inicial
  IF p_end_mileage < v_start_km THEN
    RAISE EXCEPTION 'End mileage cannot be less than start mileage';
  END IF;

  UPDATE trips
  SET status = 'COMPLETED', end_km = p_end_mileage, end_location = p_end_location,
      end_time = NOW(), updated_at = NOW()
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
