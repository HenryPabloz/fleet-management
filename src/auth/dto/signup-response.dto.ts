import { ApiProperty } from '@nestjs/swagger';

export class SignupResponseDto {
  @ApiProperty({
    description: 'Identificador do usuário criado (UUID).',
    example: 'b3c1a2e4-6f5d-4a8b-9c2e-1a2b3c4d5e6f',
  })
  userId!: string;

  @ApiProperty({
    description:
      'API key em texto puro. Só aparece nesta resposta — o banco guarda ' +
      'apenas o hash SHA-256 dela, então perdê-la exige regenerar (POST /auth/regenerate-key).',
    example: '5f1c9a2b7e4d0f3a8b6c1d2e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
  })
  apiKey!: string;

  @ApiProperty({
    description: 'E-mail cadastrado.',
    example: 'motorista@fleet.com',
  })
  email!: string;

  @ApiProperty({
    description: 'Aviso para o cliente guardar a API key com segurança.',
    example: 'Save your API key securely',
  })
  message!: string;
}
