-- Campo is_active em veículos e manutenções (igual a users e drivers).
ALTER TABLE vehicles ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE maintenances ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- Registros já apagados (soft delete) ficam inativos.
UPDATE vehicles SET is_active = false WHERE deleted_at IS NOT NULL;
UPDATE maintenances SET is_active = false WHERE deleted_at IS NOT NULL;
