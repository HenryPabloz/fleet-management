import { Module } from '@nestjs/common';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ConfigVars } from '../config/configuration';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (servicoDeConfiguracao: ConfigService<ConfigVars, true>) => ({
        secret: servicoDeConfiguracao.getOrThrow('jwt.secret', { infer: true }),
        signOptions: {
          // A config guarda texto (ex: "1h"); o tipo da lib aceita só formatos como "1h".
          expiresIn: servicoDeConfiguracao.getOrThrow('jwt.expiration', {
            infer: true,
          }) as JwtSignOptions['expiresIn'],
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy, ApiKeyGuard],
  controllers: [AuthController],
  exports: [AuthService, ApiKeyGuard, JwtModule, PassportModule],
})
export class AuthModule {}
