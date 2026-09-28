import * as joi from 'joi';

// Formato das configurações que o resto do app vai usar.
export interface ConfigVars {
  database: {
    url: string;
  };
  jwt: {
    secret: string;
    expiration: string;
  };
  app: {
    port: number;
    env: string;
  };
  gcs: {
    bucketName: string;
    projectId: string;
    keyFile: string;
  };
  external: {
    cepApiUrl: string;
    cepTimeoutMs: number;
  };
  cors: {
    origin: string;
  };
  apiKey: string;
}

// Confere o .env ao iniciar: se faltar algo obrigatório, o app não sobe.
export function validateConfig(config: Record<string, unknown>): ConfigVars {
  const schema = joi.object({
    DATABASE_URL: joi.string().required(),
    JWT_SECRET: joi.string().required(),
    // Aceita número + unidade (ex: 1h, 30m, 7d); número puro viraria milissegundos.
    JWT_EXPIRATION: joi
      .string()
      .pattern(/^\d+\s?(ms|s|m|h|d|w|y)$/i)
      .required()
      .messages({
        'string.pattern.base':
          'JWT_EXPIRATION must be a number followed by a unit (ms, s, m, h, d, w, y), e.g. 1h, 30m, 7d, 3600s',
      }),
    PORT: joi.number().default(3000),
    NODE_ENV: joi.string().default('development'),
    // Bucket do Google Cloud Storage onde ficam as fotos de incidentes.
    // Opcional (aceita vazio) para não derrubar suítes/ambientes que não
    // mexem com upload de foto e não têm credenciais de nuvem configuradas.
    GCS_BUCKET_NAME: joi.string().allow('').optional(),
    GCS_PROJECT_ID: joi.string().allow('').optional(),
    GCS_KEY_FILE: joi.string().allow('').optional(),
    CEP_API_URL: joi.string().default('https://viacep.com.br/ws'),
    CEP_TIMEOUT_MS: joi.number().default(10000),
    // "*" libera qualquer origem (uso em dev); em produção, lista separada por
    // vírgula com os domínios do frontend (ex: "https://app.com,https://admin.app.com").
    CORS_ORIGIN: joi.string().default('*'),
    // Chave fixa da aplicacao, igual para todos os usuarios (ver ApiKeyGuard).
    API_KEY: joi.string().required(),
  });

  const { value, error } = schema.validate(config, { allowUnknown: true });

  if (error) {
    throw new Error(`Config validation failed: ${error.message}`);
  }

  return {
    database: { url: value.DATABASE_URL },
    jwt: { secret: value.JWT_SECRET, expiration: value.JWT_EXPIRATION },
    app: { port: value.PORT, env: value.NODE_ENV },
    gcs: {
      bucketName: value.GCS_BUCKET_NAME,
      projectId: value.GCS_PROJECT_ID,
      keyFile: value.GCS_KEY_FILE,
    },
    external: {
      cepApiUrl: value.CEP_API_URL,
      cepTimeoutMs: value.CEP_TIMEOUT_MS,
    },
    cors: {
      origin: value.CORS_ORIGIN,
    },
    apiKey: value.API_KEY,
  };
}
