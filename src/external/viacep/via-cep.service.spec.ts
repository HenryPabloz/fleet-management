import {
  BadRequestException,
  GatewayTimeoutException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ViaCepService } from './via-cep.service';

// Reproduz o bug: cepEhValido() engolia QUALQUER exceção do buscarPorCep
// (inclusive timeout/erro de rede) e devolvia false, como se o CEP fosse
// inválido. Agora só CEP realmente inválido (BadRequestException) vira false;
// indisponibilidade do ViaCEP propaga como erro do servidor.
describe('ViaCepService.cepEhValido', () => {
  function montarServico() {
    // httpService/configService não são usados diretamente por cepEhValido:
    // ele chama this.buscarPorCep, que é mockado abaixo. O configService
    // mock só precisa responder ao .get() chamado no construtor.
    const configServiceMock = { get: jest.fn((_chave, valorPadrao) => valorPadrao) };
    const servico = new ViaCepService({} as never, configServiceMock as never);
    return servico;
  }

  it('devolve false quando o CEP é inválido/não encontrado (BadRequestException)', async () => {
    const servico = montarServico();
    jest
      .spyOn(servico, 'buscarPorCep')
      .mockRejectedValue(new BadRequestException('CEP 00000-000 não encontrado'));

    await expect(servico.cepEhValido('00000-000')).resolves.toBe(false);
  });

  it('propaga GatewayTimeoutException em vez de devolver false (timeout do ViaCEP)', async () => {
    const servico = montarServico();
    jest
      .spyOn(servico, 'buscarPorCep')
      .mockRejectedValue(new GatewayTimeoutException('Tempo esgotado ao consultar a API do ViaCEP'));

    await expect(servico.cepEhValido('01310-100')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
  });

  it('propaga InternalServerErrorException em vez de devolver false (erro de rede do ViaCEP)', async () => {
    const servico = montarServico();
    jest
      .spyOn(servico, 'buscarPorCep')
      .mockRejectedValue(new InternalServerErrorException('Não foi possível conectar à API do ViaCEP'));

    await expect(servico.cepEhValido('01310-100')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('devolve true quando o CEP é válido', async () => {
    const servico = montarServico();
    jest.spyOn(servico, 'buscarPorCep').mockResolvedValue({
      cep: '01310-100',
      fullAddress: 'São Paulo, SP',
    } as never);

    await expect(servico.cepEhValido('01310-100')).resolves.toBe(true);
  });
});
