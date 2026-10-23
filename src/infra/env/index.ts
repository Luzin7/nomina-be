import { config } from 'dotenv';
import { z } from 'zod';
config();

const booleanFlag = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z.enum(['true', 'false']).default('false'),
  )
  .transform((value) => value === 'true');

const INTERNAL_KEY_MIN_LENGTH = 32;

const internalKeyList = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)
      : value,
  z
    .array(
      z
        .string()
        .min(
          INTERNAL_KEY_MIN_LENGTH,
          `Cada chave deve ter ao menos ${INTERNAL_KEY_MIN_LENGTH} caracteres`,
        ),
    )
    .default([]),
);

export const envSchema = z.object({
  PORT: z.coerce.number().default(7777),
  DATABASE_URL: z.string().url(),
  PROD_URL: z.string().url(),
  DEV_URL: z.string().url(),
  DEPLOY_URL: z.string().url(),
  NODE_ENV: z.enum(['dev', 'production']),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string(),
  JWT_USER_ACCESS_EXPIRES_IN: z.coerce.number(),
  JWT_USER_REFRESH_EXPIRES_IN: z.coerce.number(),
  USER_REFRESH_EXPIRES_IN: z.coerce.number(),
  CRON_API_KEY: z.string().optional(),
  NOMINA_INTERNAL_KEYS: internalKeyList,

  REDIS_ENABLED: booleanFlag,
  REDIS_URL: z.string().url().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().default(0),
});

export const appEnvSchema = envSchema.superRefine((value, context) => {
  const missingInternalKeys =
    value.NODE_ENV === 'production' && value.NOMINA_INTERNAL_KEYS.length === 0;

  if (!missingInternalKeys) return;

  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['NOMINA_INTERNAL_KEYS'],
    message: 'NOMINA_INTERNAL_KEYS é obrigatória em produção',
  });
});

type EnvSchema = z.infer<typeof appEnvSchema>;
const _env = appEnvSchema.safeParse(process.env);

if (_env.success === false) {
  console.error('Invalid environment variables', _env.error.format());
  throw new Error('Invalid environment variables');
}
const env: EnvSchema = _env.data;
export { env };
