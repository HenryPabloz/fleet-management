import { DriversService } from './drivers.service';

// Confirma que GET /drivers (lista) e GET /drivers/:id devolvem `fullName`
// (join com users) sem vazar o resto do objeto `user` (email, senha, roleId).
describe('DriversService - fullName na resposta', () => {
  const motoristaDoBanco = {
    id: 'driver-1',
    userId: 'user-1',
    licenseNumber: '12345678900',
    licenseExpiry: new Date('2027-08-30'),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    user: {
      fullName: 'Carlos Eduardo Silva',
      email: 'carlos.silva@example.com',
      password: 'hash-nao-deveria-vazar',
    },
  };

  function montarServico() {
    const prismaMock = {
      comSoftDelete: {
        driver: {
          findMany: jest.fn().mockResolvedValue([motoristaDoBanco]),
          count: jest.fn().mockResolvedValue(1),
          findUnique: jest.fn().mockResolvedValue(motoristaDoBanco),
        },
      },
      driver: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'driver-1',
            user: { fullName: 'Carlos Eduardo Silva' },
          },
        ]),
      },
    };

    const softDeleteMock = {
      listarRemovidos: jest.fn().mockResolvedValue([
        { id: 'driver-1', deletedAt: new Date() },
      ]),
      contarRemovidos: jest.fn().mockResolvedValue(1),
    };

    return new DriversService(prismaMock as never, softDeleteMock as never);
  }

  it('listar() inclui fullName e não vaza email/senha do usuário', async () => {
    const servico = montarServico();

    const resultado = await servico.listar(1, 20);

    expect(resultado.data[0]).toMatchObject({
      id: 'driver-1',
      fullName: 'Carlos Eduardo Silva',
    });
    expect(resultado.data[0]).not.toHaveProperty('user');
    expect(resultado.data[0]).not.toHaveProperty('email');
    expect(resultado.data[0]).not.toHaveProperty('password');
  });

  it('buscarPorId() inclui fullName e não vaza email/senha do usuário', async () => {
    const servico = montarServico();

    const resultado = await servico.buscarPorId('driver-1');

    expect(resultado).toMatchObject({
      id: 'driver-1',
      fullName: 'Carlos Eduardo Silva',
    });
    expect(resultado).not.toHaveProperty('user');
    expect(resultado).not.toHaveProperty('email');
    expect(resultado).not.toHaveProperty('password');
  });

  it('listarRemovidos() inclui fullName sem tocar no SoftDeleteService genérico', async () => {
    const servico = montarServico();

    const resultado = await servico.listarRemovidos(1, 20);

    expect(resultado.data[0]).toMatchObject({
      id: 'driver-1',
      fullName: 'Carlos Eduardo Silva',
    });
    expect(resultado.data[0]).not.toHaveProperty('user');
  });
});
