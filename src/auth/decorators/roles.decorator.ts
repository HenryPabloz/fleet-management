import { SetMetadata } from '@nestjs/common';
import { CHAVE_PAPEIS } from '../constants/auth.constants';

// Guarda os papéis exigidos na rota; sem nenhum papel, dá erro ao subir o app.
export const Roles = (...papeis: string[]) => {
  if (papeis.length === 0) {
    throw new Error('Roles() requires at least one role');
  }
  return SetMetadata(CHAVE_PAPEIS, papeis);
};
