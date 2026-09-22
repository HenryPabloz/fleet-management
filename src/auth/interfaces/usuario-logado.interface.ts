// Usuário que a JwtStrategy coloca em request.user.
export interface UsuarioLogado {
  userId: string;
  email: string;
  roleId: string;
}
