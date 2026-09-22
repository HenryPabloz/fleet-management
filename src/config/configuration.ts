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
  aws: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    s3Bucket: string;
  };
  // gcp: {
  //   projectId: string;
  //   keyFile: string;
  // };
  external: {
    cepApiUrl: string;
  };
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
    // A AWS é opcional: aceita a variável vazia (AWS_REGION="") no .env.
    AWS_ACCESS_KEY_ID: joi.string().allow('').optional(),
    AWS_SECRET_ACCESS_KEY: joi.string().allow('').optional(),
    AWS_REGION: joi.string().allow('').optional(),
    AWS_S3_BUCKET: joi.string().allow('').optional(),
    // GOOGLE_CLOUD_PROJECT_ID: joi.string().optional(),
    // GOOGLE_CLOUD_KEY_FILE: joi.string().optional(),
    CEP_API_URL: joi.string().default('https://viacep.com.br/ws'),
  });

  const { value, error } = schema.validate(config, { allowUnknown: true });

  if (error) {
    throw new Error(`Config validation failed: ${error.message}`);
  }

  return {
    database: { url: value.DATABASE_URL },
    jwt: { secret: value.JWT_SECRET, expiration: value.JWT_EXPIRATION },
    app: { port: value.PORT, env: value.NODE_ENV },
    aws: {
      accessKeyId: value.AWS_ACCESS_KEY_ID,
      secretAccessKey: value.AWS_SECRET_ACCESS_KEY,
      region: value.AWS_REGION,
      s3Bucket: value.AWS_S3_BUCKET,
    },
    // gcp: {
    //   projectId: value.GOOGLE_CLOUD_PROJECT_ID,
    //   keyFile: value.GOOGLE_CLOUD_KEY_FILE,
    // },
    external: { cepApiUrl: value.CEP_API_URL },
  };
}
