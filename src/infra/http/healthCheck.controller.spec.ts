import { RedisService } from '@infra/cache/redis/RedisService';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { env } from '@infra/env';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './healthCheck.controller';

describe('HealthController liveness', () => {
  const previous = { commit: env.GIT_SHA, version: env.APP_VERSION };
  const controller = new HealthController(
    {} as DrizzleService,
    {} as RedisService,
  );

  afterEach(() => {
    env.GIT_SHA = previous.commit;
    env.APP_VERSION = previous.version;
  });

  it('returns version and commit from the environment', () => {
    env.GIT_SHA = 'abc123';
    env.APP_VERSION = '9.9.9';

    expect(controller.checkLiveness()).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      version: '9.9.9',
      commit: 'abc123',
    });
  });

  it('returns null version and commit when unset', () => {
    env.GIT_SHA = undefined;
    env.APP_VERSION = undefined;

    expect(controller.checkLiveness()).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      version: null,
      commit: null,
    });
  });
});

describe('HealthController readiness', () => {
  const previous = {
    commit: env.GIT_SHA,
    version: env.APP_VERSION,
    redis: env.REDIS_ENABLED,
  };
  const execute = jest.fn();
  const ping = jest.fn();
  const controller = new HealthController(
    { db: { execute } } as unknown as DrizzleService,
    { ping } as unknown as RedisService,
  );

  beforeEach(() => {
    execute.mockReset().mockResolvedValue([]);
    ping.mockReset().mockResolvedValue(true);
    env.REDIS_ENABLED = true;
  });

  afterEach(() => {
    env.GIT_SHA = previous.commit;
    env.APP_VERSION = previous.version;
    env.REDIS_ENABLED = previous.redis;
  });

  it('returns version and commit from the environment', async () => {
    env.GIT_SHA = 'abc123';
    env.APP_VERSION = '9.9.9';

    await expect(controller.checkReadiness()).resolves.toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      version: '9.9.9',
      commit: 'abc123',
    });
  });

  it('returns null version and commit when unset', async () => {
    env.GIT_SHA = undefined;
    env.APP_VERSION = undefined;

    await expect(controller.checkReadiness()).resolves.toMatchObject({
      version: null,
      commit: null,
    });
  });

  it('fails when the database is unavailable', async () => {
    execute.mockRejectedValue(new Error('db down'));

    await expect(controller.checkReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails when redis does not answer', async () => {
    ping.mockResolvedValue(false);

    await expect(controller.checkReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
