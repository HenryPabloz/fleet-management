import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateConfig } from './config/configuration';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { ViaCepModule } from './external/viacep/via-cep.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PermissionsModule } from './permissions/permissions.module';
import { DriversModule } from './drivers/drivers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { MaintenancesModule } from './maintenances/maintenances.module';
import { TripsModule } from './trips/trips.module';
import { RefuelingsModule } from './refuelings/refuelings.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate: validateConfig,
      isGlobal: true,
    }),
    // Limite geral de requisições: 20 por minuto, para toda a API.
    // Desligado em teste (NODE_ENV=test) para não derrubar os e2e por excesso de chamadas seguidas.
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 20,
        skipIf: () => process.env.NODE_ENV === 'test',
      },
    ]),
    DatabaseModule,
    ViaCepModule,
    AuthModule,
    UsersModule,
    PermissionsModule,
    DriversModule,
    VehiclesModule,
    MaintenancesModule,
    TripsModule,
    RefuelingsModule,
    IncidentsModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Aplica o rate limiting em todas as rotas por padrão.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Loga método, rota, usuário, status e duração de cada requisição.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
