import { appEnvSchema, envSchema } from './index';

const redisEnabled = envSchema.shape.REDIS_ENABLED;

describe('envSchema', () => {
  it('reads REDIS_ENABLED=false as disabled', () => {
    expect(redisEnabled.parse('false')).toBe(false);
  });

  it('reads REDIS_ENABLED=true as enabled', () => {
    expect(redisEnabled.parse('true')).toBe(true);
  });

  it('ignores case and surrounding spaces in REDIS_ENABLED', () => {
    expect(redisEnabled.parse(' TRUE ')).toBe(true);
  });

  it('keeps Redis disabled when REDIS_ENABLED is absent', () => {
    expect(redisEnabled.parse(undefined)).toBe(false);
  });

  it('rejects an ambiguous REDIS_ENABLED', () => {
    expect(() => redisEnabled.parse('yes')).toThrow();
  });
});

describe('NOMINA_INTERNAL_KEYS', () => {
  const validKey = 'a'.repeat(32);
  const previousKey = 'b'.repeat(32);
  const baseEnv = {
    DATABASE_URL: 'postgresql://user:password@localhost:5432/testdb',
    PROD_URL: 'http://localhost:8080',
    DEV_URL: 'http://localhost:8080',
    DEPLOY_URL: 'http://localhost:8080',
    NODE_ENV: 'dev',
    JWT_PRIVATE_KEY: 'test-private-key',
    JWT_PUBLIC_KEY: 'test-public-key',
    JWT_USER_ACCESS_EXPIRES_IN: '900',
    JWT_USER_REFRESH_EXPIRES_IN: '604800',
    USER_REFRESH_EXPIRES_IN: '604800',
  };

  it('requires NOMINA_INTERNAL_KEYS in production', () => {
    const result = appEnvSchema.safeParse({
      ...baseEnv,
      NODE_ENV: 'production',
    });

    expect(result.success).toBe(false);
  });

  it('accepts production with a valid key', () => {
    const result = appEnvSchema.safeParse({
      ...baseEnv,
      NODE_ENV: 'production',
      NOMINA_INTERNAL_KEYS: validKey,
    });

    expect(result.success).toBe(true);
  });

  it('is optional outside production', () => {
    const result = appEnvSchema.safeParse(baseEnv);

    expect(result.success && result.data.NOMINA_INTERNAL_KEYS).toEqual([]);
  });

  it('rejects internal keys shorter than 32 characters', () => {
    const result = appEnvSchema.safeParse({
      ...baseEnv,
      NOMINA_INTERNAL_KEYS: 'a'.repeat(31),
    });

    expect(result.success).toBe(false);
  });

  it('parses a comma-separated key list', () => {
    const result = appEnvSchema.safeParse({
      ...baseEnv,
      NOMINA_INTERNAL_KEYS: ` ${validKey}, ${previousKey} `,
    });

    expect(result.success && result.data.NOMINA_INTERNAL_KEYS).toEqual([
      validKey,
      previousKey,
    ]);
  });
});
