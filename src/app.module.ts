import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateConfig } from './config/configuration';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { ViaCepModule } from './external/viacep/via-cep.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PermissionsModule } from './permissions/permissions.module';
import { RolesModule } from './roles/roles.module';
import { DriversModule } from './drivers/drivers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { MaintenancesModule } from './maintenances/maintenances.module';
import { TripsModule } from './trips/trips.module';
import { RefuelingsModule } from './refuelings/refuelings.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { HealthModule } from './health/health.module';

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
    RolesModule,
    DriversModule,
    VehiclesModule,
    MaintenancesModule,
    TripsModule,
    RefuelingsModule,
    IncidentsModule,
    AnalyticsModule,
    AuditLogsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Aplica o rate limiting em todas as rotas por padrão.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Loga método, rota, usuário, status e duração de cada requisição.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    // Captura toda HttpException (e erro genérico) e devolve no formato
    // RFC 7807 (Problem Details), substituindo o formato padrão do Nest.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
