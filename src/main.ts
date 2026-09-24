import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { useContainer } from 'class-validator';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';
import { ConfigVars } from './config/configuration';
import { PrismaService } from './database/prisma.service';
import { enriquecerSwaggerComRoles } from './common/swagger/enriquecer-swagger-com-roles';
import { garantirPastaDeUploads } from './incidents/utils/upload-incidents.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Adiciona headers de segurança padrão e desliga o X-Powered-By.
  app.use(helmet());
  // Comprime as respostas (gzip) quando o cliente aceita.
  app.use(compression());

  // CORS_ORIGIN="*" libera qualquer origem (dev); em produção, use uma lista
  // de domínios separados por vírgula. O navegador rejeita "*" junto com
  // credentials: true, então credentials só liga quando a origem é restrita.
  const servicoDeConfiguracao = app.get(ConfigService<ConfigVars, true>);
  const origemCors = servicoDeConfiguracao.get('cors.origin', { infer: true });
  if (origemCors === '*') {
    app.enableCors({ origin: '*' });
  } else {
    const origensPermitidas = origemCors.split(',').map((origem) => origem.trim());
    app.enableCors({ origin: origensPermitidas, credentials: true });
  }

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
  // Coloca no Swagger os IDs reais das roles deste ambiente.
  await enriquecerSwaggerComRoles(documento, app.get(PrismaService));
  // CSS extra: destaca os códigos (ex: IDs das roles) SÓ na descrição da operação.
  // Bodys de exemplo, schemas e descrições de campos ficam com a cor padrão do Swagger.
  const cssDosCodigos =
    '.swagger-ui .opblock-description-wrapper .renderedMarkdown code {' +
    ' background: #0400e0 !important; color: #ffffff !important; font-weight: 700 !important;' +
    ' padding: 2px 6px !important; border-radius: 4px !important; border: 1px solid #0400e0 !important; }' +
    // No modo escuro do Swagger as células (td) das tabelas da descrição ficam cinza escuro (o tema só clareia parágrafos e cabeçalhos).
    ' html.dark-mode .swagger-ui .opblock-description-wrapper .renderedMarkdown table td { color: #e4e6e6 !important; }';
  SwaggerModule.setup('api/docs', app, documento, { customCss: cssDosCodigos });

  await app.listen(porta);
}
bootstrap();
