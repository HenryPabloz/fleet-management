import { SetMetadata } from '@nestjs/common';
import { CHAVE_PERMISSOES } from '../constants/auth.constants';

// Guarda as permissões exigidas; sem nenhuma, dá erro ao subir o app.
export const Permissions = (...permissoes: string[]) => {
  if (permissoes.length === 0) {
    throw new Error('Permissions() requires at least one permission');
  }
  return SetMetadata(CHAVE_PERMISSOES, permissoes);
};
