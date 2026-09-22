// Status que o DTO aceita em create/update/replace. IN_USE fica de fora de
// propósito: só as procedures de viagem podem colocar um veículo em uso
// (trigger no banco bloqueia escrita direta com 'IN_USE is set only by trips').
export const STATUS_VEHICLE_ACEITOS_NA_ESCRITA = [
  'AVAILABLE',
  'IN_MAINTENANCE',
  'OUT_OF_SERVICE',
] as const;

export type StatusVehicleEscrita =
  (typeof STATUS_VEHICLE_ACEITOS_NA_ESCRITA)[number];
