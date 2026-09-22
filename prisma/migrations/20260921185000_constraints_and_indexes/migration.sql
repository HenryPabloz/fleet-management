-- CHECKs de integridade (o Prisma não rastreia CHECK, então o diff continua limpo) e índices novos.
-- O banco estava vazio ao criar estas regras, então nenhum dado existente precisa de correção.
-- O aplicativo deve gravar plate em MAIÚSCULAS e email em minúsculas (sem espaços nas pontas).

-- vehicles
ALTER TABLE vehicles
  ADD CONSTRAINT ck_vehicles_year_range CHECK (year BETWEEN 1900 AND 2100),
  ADD CONSTRAINT ck_vehicles_current_mileage_range CHECK (current_mileage BETWEEN 0 AND 10000000),
  ADD CONSTRAINT ck_vehicles_last_maintenance_km_range CHECK (last_maintenance_km BETWEEN 0 AND 10000000),
  ADD CONSTRAINT ck_vehicles_plate_normalized CHECK (plate = upper(btrim(plate)) AND char_length(plate) BETWEEN 7 AND 8),
  ADD CONSTRAINT ck_vehicles_model_not_empty CHECK (btrim(model) <> '');

-- users
ALTER TABLE users
  ADD CONSTRAINT ck_users_email_normalized CHECK (email = lower(btrim(email)) AND btrim(email) <> ''),
  ADD CONSTRAINT ck_users_password_not_empty CHECK (btrim(password) <> '');

-- trips
ALTER TABLE trips
  ADD CONSTRAINT ck_trips_start_km_range CHECK (start_km BETWEEN 0 AND 10000000),
  ADD CONSTRAINT ck_trips_end_km_range CHECK (end_km IS NULL OR end_km BETWEEN 0 AND 10000000),
  ADD CONSTRAINT ck_trips_end_km_gte_start_km CHECK (end_km IS NULL OR end_km >= start_km),
  ADD CONSTRAINT ck_trips_end_time_gte_start_time CHECK (end_time IS NULL OR end_time >= start_time),
  ADD CONSTRAINT ck_trips_completed_requires_end CHECK (status <> 'COMPLETED' OR (end_km IS NOT NULL AND end_time IS NOT NULL)),
  ADD CONSTRAINT ck_trips_locations_not_empty CHECK (btrim(start_location) <> '' AND btrim(end_location) <> '');

-- refuelings
ALTER TABLE refuelings
  ADD CONSTRAINT ck_refuelings_mileage_range CHECK (mileage BETWEEN 1 AND 10000000),
  ADD CONSTRAINT ck_refuelings_liters_positive CHECK (liters_added > 0),
  ADD CONSTRAINT ck_refuelings_cost_per_liter_positive CHECK (cost_per_liter > 0),
  ADD CONSTRAINT ck_refuelings_total_cost_not_negative CHECK (total_cost >= 0),
  ADD CONSTRAINT ck_refuelings_total_cost_matches CHECK (total_cost = ROUND(liters_added * cost_per_liter, 2));

-- maintenances
ALTER TABLE maintenances
  ADD CONSTRAINT ck_maintenances_cost_not_negative CHECK (cost >= 0),
  ADD CONSTRAINT ck_maintenances_description_not_empty CHECK (btrim(description) <> ''),
  ADD CONSTRAINT ck_maintenances_completed_after_scheduled CHECK (completed_date IS NULL OR completed_date >= scheduled_date),
  ADD CONSTRAINT ck_maintenances_completed_requires_date CHECK (status <> 'COMPLETED' OR completed_date IS NOT NULL);

-- incidents
ALTER TABLE incidents
  ADD CONSTRAINT ck_incidents_description_not_empty CHECK (btrim(description) <> ''),
  ADD CONSTRAINT ck_incidents_photo_url_http CHECK (photo_url IS NULL OR photo_url ~* '^https?://.+');

-- Índices (mesmo padrão de nome do Prisma)
CREATE INDEX "incidents_fk_trip_id_idx" ON "incidents"("fk_trip_id");
CREATE INDEX "incidents_fk_user_id_idx" ON "incidents"("fk_user_id");
CREATE INDEX "trips_fk_user_id_idx" ON "trips"("fk_user_id");
CREATE INDEX "trips_fk_vehicle_id_status_idx" ON "trips"("fk_vehicle_id", "status");
CREATE INDEX "trips_fk_driver_id_status_idx" ON "trips"("fk_driver_id", "status");
CREATE INDEX "refuelings_fk_user_id_idx" ON "refuelings"("fk_user_id");
CREATE INDEX "maintenances_fk_user_id_idx" ON "maintenances"("fk_user_id");
CREATE INDEX "maintenances_fk_vehicle_id_status_idx" ON "maintenances"("fk_vehicle_id", "status");
