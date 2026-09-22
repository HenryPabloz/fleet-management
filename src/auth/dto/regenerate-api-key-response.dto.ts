import { ApiProperty } from '@nestjs/swagger';

export class RegenerateApiKeyResponseDto {
  @ApiProperty({
    description: 'Nova API key em texto puro. A chave antiga é invalidada imediatamente.',
    example: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b',
  })
  newApiKey!: string;

  @ApiProperty({
    description: 'Aviso de que a chave antiga não funciona mais.',
    example: 'Old key is now invalid',
  })
  message!: string;
}
