-- Apagar um veículo passa a apagar os abastecimentos dele junto.
-- Viagens, manutenções e incidentes continuam bloqueando (RESTRICT).

ALTER TABLE refuelings DROP CONSTRAINT refuelings_fk_vehicle_id_fkey;
ALTER TABLE refuelings
  ADD CONSTRAINT refuelings_fk_vehicle_id_fkey
  FOREIGN KEY (fk_vehicle_id) REFERENCES vehicles(id_vehicle) ON UPDATE CASCADE ON DELETE CASCADE;
