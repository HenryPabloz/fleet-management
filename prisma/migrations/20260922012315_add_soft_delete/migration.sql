-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "maintenances" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "refuelings" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "drivers_deleted_at_idx" ON "drivers"("deleted_at");

-- CreateIndex
CREATE INDEX "incidents_deleted_at_idx" ON "incidents"("deleted_at");

-- CreateIndex
CREATE INDEX "incidents_fk_vehicle_id_deleted_at_idx" ON "incidents"("fk_vehicle_id", "deleted_at");

-- CreateIndex
CREATE INDEX "incidents_fk_driver_id_deleted_at_idx" ON "incidents"("fk_driver_id", "deleted_at");

-- CreateIndex
CREATE INDEX "maintenances_deleted_at_idx" ON "maintenances"("deleted_at");

-- CreateIndex
CREATE INDEX "maintenances_fk_vehicle_id_deleted_at_idx" ON "maintenances"("fk_vehicle_id", "deleted_at");

-- CreateIndex
CREATE INDEX "refuelings_deleted_at_idx" ON "refuelings"("deleted_at");

-- CreateIndex
CREATE INDEX "refuelings_fk_vehicle_id_deleted_at_idx" ON "refuelings"("fk_vehicle_id", "deleted_at");

-- CreateIndex
CREATE INDEX "refuelings_fk_driver_id_deleted_at_idx" ON "refuelings"("fk_driver_id", "deleted_at");

-- CreateIndex
CREATE INDEX "trips_deleted_at_idx" ON "trips"("deleted_at");

-- CreateIndex
CREATE INDEX "trips_fk_driver_id_deleted_at_idx" ON "trips"("fk_driver_id", "deleted_at");

-- CreateIndex
CREATE INDEX "trips_fk_vehicle_id_deleted_at_idx" ON "trips"("fk_vehicle_id", "deleted_at");

-- CreateIndex
CREATE INDEX "trips_status_deleted_at_idx" ON "trips"("status", "deleted_at");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "vehicles_deleted_at_idx" ON "vehicles"("deleted_at");
