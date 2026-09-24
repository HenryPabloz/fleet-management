import { NotFoundException } from '@nestjs/common';
import { TripsService } from './trips.service';

// Reproduz o bug do IDOR em GET /trips/:id: motorista sem TRIP_VIEW_ALL não
// pode ler o detalhe de uma viagem que não é dele. Prisma mockado na unha,
// só com o que buscarPorId usa.
describe('TripsService.buscarPorId', () => {
  const viagemDeOutroMotorista = {
    id: 'trip-1',
    driverId: 'driver-outro',
  };

  function montarServico(driverIdDoUsuarioLogado: string | null) {
    const prismaMock = {
      comSoftDelete: {
        trip: {
          findUnique: jest.fn().mockResolvedValue(viagemDeOutroMotorista),
        },
        driver: {
          findUnique: jest.fn().mockResolvedValue(
            driverIdDoUsuarioLogado ? { id: driverIdDoUsuarioLogado } : null,
          ),
        },
      },
    };

    const servico = new TripsService(
      prismaMock as never,
      {} as never,
      {} as never,
    );

    return servico;
  }

  it('devolve 404 quando o DRIVER sem TRIP_VIEW_ALL não é dono da viagem', async () => {
    const servico = montarServico('driver-logado');

    await expect(
      servico.buscarPorId('trip-1', {
        userId: 'user-1',
        temPermissaoViewAll: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devolve a viagem quando o usuário tem TRIP_VIEW_ALL, mesmo não sendo o dono', async () => {
    const servico = montarServico('driver-logado');

    const resultado = await servico.buscarPorId('trip-1', {
      userId: 'user-1',
      temPermissaoViewAll: true,
    });

    expect(resultado).toBe(viagemDeOutroMotorista);
  });

  it('devolve a viagem quando o usuário logado é o próprio dono', async () => {
    const servico = montarServico('driver-outro');

    const resultado = await servico.buscarPorId('trip-1', {
      userId: 'user-1',
      temPermissaoViewAll: false,
    });

    expect(resultado).toBe(viagemDeOutroMotorista);
  });
});
