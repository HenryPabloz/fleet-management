import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// Resolve o Driver.id do usuário logado (via User.id), usado nas listagens
// "OWN" (trips/refuelings/incidents) para forçar o filtro no próprio
// motorista. Usuário sem Driver vinculado (ex: papel DRIVER sem perfil de
// Driver criado ainda) devolve null — quem chama trata isso como "lista vazia".
export async function buscarDriverIdProprio(
  servicoPrisma: PrismaService,
  userId: string,
): Promise<string | null> {
  const driver = await servicoPrisma.comSoftDelete.driver.findUnique({
    where: { userId },
  });
  if (!driver) {
    return null;
  }
  return driver.id;
}

export interface EscopoDoUsuario {
  userId: string;
  temPermissaoViewAll: boolean;
}

// Quem não tem a permissão *_VIEW_ALL só pode agir no próprio driverId.
// Se o driverId do corpo for de outro motorista, devolve 403.
export async function garantirDriverIdProprio(
  servicoPrisma: PrismaService,
  escopo: EscopoDoUsuario,
  driverIdDoCorpo: string,
): Promise<void> {
  if (escopo.temPermissaoViewAll) {
    return;
  }
  const driverIdProprio = await buscarDriverIdProprio(servicoPrisma, escopo.userId);
  if (!driverIdProprio || driverIdProprio !== driverIdDoCorpo) {
    throw new ForbiddenException('driverId must be your own driver profile');
  }
}
