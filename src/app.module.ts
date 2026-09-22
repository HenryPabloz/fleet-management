import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateConfig } from './config/configuration';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';

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
    AuthModule,
    UsersModule,
    DriversModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Aplica o rate limiting em todas as rotas por padrão.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
