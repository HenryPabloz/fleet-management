import { PrismaService } from '../../database/prisma.service';

// Junta as permissões do papel com as concedidas individualmente ao usuário.
// Fica aqui (e não no PermissionsService) para o AuthService usar sem ciclo de módulos.
export async function buscarCodigosEfetivos(
  servicoPrisma: PrismaService,
  usuarioId: string,
  roleId: string,
): Promise<string[]> {
  const [permissoesDoPapel, permissoesIndividuais] = await Promise.all([
    servicoPrisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    }),
    servicoPrisma.userPermission.findMany({
      where: { userId: usuarioId },
      include: { permission: true },
    }),
  ]);

  return [
    ...permissoesDoPapel.map((item) => item.permission.code),
    ...permissoesIndividuais.map((item) => item.permission.code),
  ];
}

// Id do perfil Driver ativo (não removido) do usuário, ou null se não tiver.
export async function buscarDriverIdAtivo(
  servicoPrisma: PrismaService,
  usuarioId: string,
): Promise<string | null> {
  const motorista = await servicoPrisma.comSoftDelete.driver.findFirst({
    where: { userId: usuarioId, isActive: true },
    select: { id: true },
  });
  if (!motorista) {
    return null;
  }
  return motorista.id;
}
