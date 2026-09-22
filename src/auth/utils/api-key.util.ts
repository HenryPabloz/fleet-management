import { createHash, randomBytes } from 'crypto';

// Cria uma chave aleatória de 64 letras/números (256 bits).
export function gerarApiKey(): string {
  return randomBytes(32).toString('hex');
}

// O banco guarda só este resumo (SHA-256) da chave, nunca a chave em si.
export function calcularHashApiKey(chave: string): string {
  return createHash('sha256').update(chave).digest('hex');
}
