import { ApiProperty } from '@nestjs/swagger';

class LoginUsuarioDto {
  @ApiProperty({
    description: 'Identificador do usuário (UUID).',
    example: 'b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f',
  })
  id!: string;

  @ApiProperty({
    description: 'E-mail do usuário.',
    example: 'motorista@fleet.com',
  })
  email!: string;

  @ApiProperty({ description: 'Nome completo.', example: 'João da Silva' })
  fullName!: string;

  @ApiProperty({
    description: 'Nome do papel (role) do usuário.',
    example: 'DRIVER',
  })
  role!: string;

  @ApiProperty({
    description: 'Códigos das permissões efetivas: as do papel mais as concedidas individualmente.',
    type: [String],
    example: ['PROFILE_VIEW', 'TRIP_VIEW_OWN', 'TRIP_CREATE'],
  })
  permissions!: string[];

  @ApiProperty({
    description: 'Id do perfil de motorista ativo do usuário (usado em driverId de viagens, abastecimentos e incidentes), ou null se não tiver.',
    type: String,
    nullable: true,
    example: 'c7d8e9f0-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
  })
  driverId!: string | null;
}

export class LoginResponseDto {
  @ApiProperty({
    description: 'Token JWT a ser enviado em `Authorization: Bearer <token>` nas rotas protegidas.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiM2MxYTJlNCJ9.4Z8f2Q9nJp6xW3vY1sR7tU0eL5kM8oI2aB6cD9fG3hJ',
  })
  accessToken!: string;

  @ApiProperty({ description: 'Dados básicos do usuário autenticado.', type: () => LoginUsuarioDto })
  user!: LoginUsuarioDto;
}
