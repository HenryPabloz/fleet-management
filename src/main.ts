import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { useContainer } from 'class-validator';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';
import { garantirPastaDeUploads } from './incidents/utils/upload-incidents.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Adiciona headers de segurança padrão e desliga o X-Powered-By.
  app.use(helmet());
  // Comprime as respostas (gzip) quando o cliente aceita.
  app.use(compression());

  // Cria a pasta de uploads se não existir e serve os arquivos em /uploads/*
  // (é assim que a photoUrl de um incidente funciona de verdade).
  garantirPastaDeUploads();
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  // Faz o Nest fechar tudo direito (inclusive o banco) ao receber Ctrl+C ou SIGTERM.
  app.enableShutdownHooks();
  // Faz os decorators do DTO (ex: @IsEmail) valerem e recusa campos extras.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Sem isso, um @ValidatorConstraint({ async: true }) com @Injectable() (como o
  // IsValidCepConstraint) não consegue injetar o ViaCepService: o class-validator
  // usaria seu próprio container em vez do container de DI do Nest.
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  const porta = process.env.PORT ?? 3000;

  // Monta a documentação da API (Swagger/OpenAPI) e expõe em /docs.
  const documentoSwagger = new DocumentBuilder()
    .setTitle('API de Gestão de Frota Corporativa')
    .setDescription(
      'API para gestão de veículos, motoristas, viagens e indicadores de uma frota corporativa.',
    )
    .setVersion('1.0.0')
    .addServer(`http://localhost:${porta}`, 'Ambiente local')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();
  const documento = SwaggerModule.createDocument(app, documentoSwagger);
  SwaggerModule.setup('api/docs', app, documento);

  await app.listen(porta);
}
bootstrap();
