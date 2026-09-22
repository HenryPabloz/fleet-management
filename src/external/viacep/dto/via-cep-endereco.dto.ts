// Formato de resposta da API ViaCEP (https://viacep.com.br/ws/{cep}/json/).
// Os nomes de campo da API em si ficam como a API devolve (cep, logradouro,
// bairro, localidade, uf, ibge, ddd, siafi, complemento, gia); só o campo
// enriquecido (fullAddress) é acrescentado por nós.
export class ViaCepEnderecoDto {
  cep!: string;
  logradouro!: string;
  complemento?: string;
  bairro!: string;
  localidade!: string;
  uf!: string;
  ibge!: string;
  gia?: string;
  ddd!: string;
  siafi!: string;

  // Enriquecido por nós: "São Paulo, SP". É esse texto que vira
  // startLocation/endLocation da viagem e initialLocation do veículo.
  fullAddress!: string;
}
