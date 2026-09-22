export interface JwtPayload {
  sub: string; // userId
  email: string;
  roleId: string;
  iat: number;
  exp: number;
}
