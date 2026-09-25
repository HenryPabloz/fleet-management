// Sem campos: o `startKm` é o hodômetro do veículo, que nunca vem do cliente.
// Com forbidNonWhitelisted, qualquer campo enviado (ex: `currentMileage`) dá 400.
export class StartTripDto {}
