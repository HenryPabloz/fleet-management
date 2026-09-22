import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

// PrismaService não precisa ser importado aqui: DatabaseModule é @Global().
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
