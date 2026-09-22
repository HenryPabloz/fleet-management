-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'GASOLINE', 'ETHANOL', 'HYBRID');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'INSPECTION');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('ACCIDENT', 'MECHANICAL_FAILURE', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "users" (
    "id_user" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "fk_role_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id_user")
);

-- CreateTable
CREATE TABLE "roles" (
    "id_role" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id_role")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id_permission" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id_permission")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "fk_role_id" UUID NOT NULL,
    "fk_permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("fk_role_id","fk_permission_id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "fk_user_id" UUID NOT NULL,
    "fk_permission_id" UUID NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("fk_user_id","fk_permission_id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id_driver" UUID NOT NULL,
    "fk_user_id" UUID NOT NULL,
    "license_number" VARCHAR(20) NOT NULL,
    "license_expiry" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id_driver")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id_vehicle" UUID NOT NULL,
    "plate" VARCHAR(8) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "year" SMALLINT NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "current_mileage" INTEGER NOT NULL,
    "last_maintenance_km" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id_vehicle")
);

-- CreateTable
CREATE TABLE "trips" (
    "id_trip" UUID NOT NULL,
    "fk_driver_id" UUID NOT NULL,
    "fk_vehicle_id" UUID NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "start_km" INTEGER NOT NULL,
    "end_km" INTEGER,
    "start_location" VARCHAR(255) NOT NULL,
    "end_location" VARCHAR(255) NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" TIMESTAMP(3),
    "fk_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id_trip")
);

-- CreateTable
CREATE TABLE "refuelings" (
    "id_refueling" UUID NOT NULL,
    "fk_vehicle_id" UUID NOT NULL,
    "fk_driver_id" UUID NOT NULL,
    "mileage" INTEGER NOT NULL,
    "liters_added" DECIMAL(10,2) NOT NULL,
    "cost_per_liter" DECIMAL(10,4) NOT NULL,
    "total_cost" DECIMAL(12,2) NOT NULL,
    "fuel_type" "FuelType" NOT NULL,
    "fk_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refuelings_pkey" PRIMARY KEY ("id_refueling")
);

-- CreateTable
CREATE TABLE "maintenances" (
    "id_maintenance" UUID NOT NULL,
    "fk_vehicle_id" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "completed_date" TIMESTAMP(3),
    "description" VARCHAR(1000) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "fk_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenances_pkey" PRIMARY KEY ("id_maintenance")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id_incident" UUID NOT NULL,
    "fk_trip_id" UUID,
    "fk_vehicle_id" UUID NOT NULL,
    "fk_driver_id" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'LOW',
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "description" VARCHAR(1000) NOT NULL,
    "photo_url" VARCHAR(500),
    "photo_key" VARCHAR(255),
    "fk_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id_incident")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id_audit_log" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "fk_user_id" UUID NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id_audit_log")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_fk_role_id_idx" ON "users"("fk_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_fk_permission_id_idx" ON "role_permissions"("fk_permission_id");

-- CreateIndex
CREATE INDEX "user_permissions_fk_permission_id_idx" ON "user_permissions"("fk_permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_fk_user_id_key" ON "drivers"("fk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_license_number_key" ON "drivers"("license_number");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");

-- CreateIndex
CREATE INDEX "trips_fk_driver_id_idx" ON "trips"("fk_driver_id");

-- CreateIndex
CREATE INDEX "trips_fk_vehicle_id_idx" ON "trips"("fk_vehicle_id");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trips_created_at_idx" ON "trips"("created_at");

-- CreateIndex
CREATE INDEX "refuelings_fk_vehicle_id_idx" ON "refuelings"("fk_vehicle_id");

-- CreateIndex
CREATE INDEX "refuelings_fk_driver_id_idx" ON "refuelings"("fk_driver_id");

-- CreateIndex
CREATE INDEX "refuelings_created_at_idx" ON "refuelings"("created_at");

-- CreateIndex
CREATE INDEX "maintenances_fk_vehicle_id_idx" ON "maintenances"("fk_vehicle_id");

-- CreateIndex
CREATE INDEX "maintenances_status_idx" ON "maintenances"("status");

-- CreateIndex
CREATE INDEX "incidents_fk_vehicle_id_idx" ON "incidents"("fk_vehicle_id");

-- CreateIndex
CREATE INDEX "incidents_fk_driver_id_idx" ON "incidents"("fk_driver_id");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_created_at_idx" ON "incidents"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_fk_user_id_idx" ON "audit_logs"("fk_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_fk_role_id_fkey" FOREIGN KEY ("fk_role_id") REFERENCES "roles"("id_role") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_fk_role_id_fkey" FOREIGN KEY ("fk_role_id") REFERENCES "roles"("id_role") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_fk_permission_id_fkey" FOREIGN KEY ("fk_permission_id") REFERENCES "permissions"("id_permission") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_fk_user_id_fkey" FOREIGN KEY ("fk_user_id") REFERENCES "users"("id_user") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_fk_permission_id_fkey" FOREIGN KEY ("fk_permission_id") REFERENCES "permissions"("id_permission") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_fk_user_id_fkey" FOREIGN KEY ("fk_user_id") REFERENCES "users"("id_user") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_fk_driver_id_fkey" FOREIGN KEY ("fk_driver_id") REFERENCES "drivers"("id_driver") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_fk_vehicle_id_fkey" FOREIGN KEY ("fk_vehicle_id") REFERENCES "vehicles"("id_vehicle") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_fk_user_id_fkey" FOREIGN KEY ("fk_user_id") REFERENCES "users"("id_user") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refuelings" ADD CONSTRAINT "refuelings_fk_vehicle_id_fkey" FOREIGN KEY ("fk_vehicle_id") REFERENCES "vehicles"("id_vehicle") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refuelings" ADD CONSTRAINT "refuelings_fk_driver_id_fkey" FOREIGN KEY ("fk_driver_id") REFERENCES "drivers"("id_driver") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refuelings" ADD CONSTRAINT "refuelings_fk_user_id_fkey" FOREIGN KEY ("fk_user_id") REFERENCES "users"("id_user") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_fk_vehicle_id_fkey" FOREIGN KEY ("fk_vehicle_id") REFERENCES "vehicles"("id_vehicle") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_fk_user_id_fkey" FOREIGN KEY ("fk_user_id") REFERENCES "users"("id_user") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_fk_trip_id_fkey" FOREIGN KEY ("fk_trip_id") REFERENCES "trips"("id_trip") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_fk_vehicle_id_fkey" FOREIGN KEY ("fk_vehicle_id") REFERENCES "vehicles"("id_vehicle") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_fk_driver_id_fkey" FOREIGN KEY ("fk_driver_id") REFERENCES "drivers"("id_driver") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_fk_user_id_fkey" FOREIGN KEY ("fk_user_id") REFERENCES "users"("id_user") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_fk_user_id_fkey" FOREIGN KEY ("fk_user_id") REFERENCES "users"("id_user") ON DELETE RESTRICT ON UPDATE CASCADE;
