import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service';

// Endpoint de infraestrutura: sem autenticação (é o que um orquestrador tipo
// Docker/Kubernetes chama pra saber se o container está de pé) e fora do
// rate limiting agressivo, já que pode ser chamado com frequência alta.
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly servicoDeHealthCheck: HealthCheckService,
    private readonly indicadorDePrisma: PrismaHealthIndicator,
    private readonly indicadorDeMemoria: MemoryHealthIndicator,
    private readonly servicoPrisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  verificar() {
    return this.servicoDeHealthCheck.check([
      () => this.indicadorDePrisma.pingCheck('database', this.servicoPrisma),
      // O processo não deveria usar mais que 300MB de heap; passar disso é sinal de vazamento.
      () => this.indicadorDeMemoria.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }
}
