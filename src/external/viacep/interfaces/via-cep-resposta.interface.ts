// União sucesso/erro da resposta crua da API ViaCEP, antes do enriquecimento.
export type ViaCepResposta = ViaCepRespostaSucesso | ViaCepRespostaErro;

export interface ViaCepRespostaSucesso {
  cep: string;
  logradouro: string;
  complemento?: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  gia?: string;
  ddd: string;
  siafi: string;
  erro?: never;
}

// A API devolve { erro: "true" } (string, não boolean!) quando o CEP não
// existe, sem os outros campos.
export interface ViaCepRespostaErro {
  erro: 'true';
}
