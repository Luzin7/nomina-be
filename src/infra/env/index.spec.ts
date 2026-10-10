import { envSchema } from './index';

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
