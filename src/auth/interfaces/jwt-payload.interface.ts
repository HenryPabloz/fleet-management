export interface JwtPayload {
  sub: string; // userId
  email: string;
  roleId: string;
  iat: number; //iat (issued at) marca quando o jwt foi emitido
  exp: number; // exp (expiration) marca quando ele expira
}
