-- Troca o CHECK de placa: antes só validava tamanho, agora exige o formato real
-- (Mercosul: 3 letras+1 numero+1 letra+2 numeros, ou antigo: 3 letras+4 numeros, com ou sem hifen).
ALTER TABLE vehicles DROP CONSTRAINT ck_vehicles_plate_normalized;
ALTER TABLE vehicles ADD CONSTRAINT ck_vehicles_plate_normalized
  CHECK (plate = upper(btrim(plate)) AND plate ~ '^([A-Z]{3}[0-9][A-Z][0-9]{2}|[A-Z]{3}-?[0-9]{4})$');

-- Novo CHECK: CNH do motorista precisa ter exatamente 11 digitos numericos.
ALTER TABLE drivers ADD CONSTRAINT ck_drivers_license_number_format
  CHECK (license_number ~ '^[0-9]{11}$');
