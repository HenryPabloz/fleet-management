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
