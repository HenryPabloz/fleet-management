-- Veículo não pode nascer IN_USE: esse status só é definido pelas viagens.
-- AVAILABLE, IN_MAINTENANCE e OUT_OF_SERVICE continuam permitidos na criação.
CREATE OR REPLACE FUNCTION fn_block_vehicle_in_use_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'IN_USE' THEN
    RAISE EXCEPTION 'IN_USE is set only by trips';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_block_vehicle_in_use_on_insert
BEFORE INSERT ON vehicles
FOR EACH ROW
EXECUTE FUNCTION fn_block_vehicle_in_use_on_insert();
