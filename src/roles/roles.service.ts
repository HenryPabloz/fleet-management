import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class RolesService {
  constructor(private servicoPrisma: PrismaService) {}

  // Lista os papéis (são só 3 fixos, por isso sem paginação).
  async listar() {
    return this.servicoPrisma.role.findMany({
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }
}
