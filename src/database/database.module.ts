import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global: qualquer módulo usa o PrismaService sem importar este módulo.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
