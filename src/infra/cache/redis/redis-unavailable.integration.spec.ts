import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Idempotent } from '@providers/auth/decorators/Idempotency.decorator';

const DEAD_REDIS_URL = 'redis://127.0.0.1:6399';
const ERROR_EVENT_TIMEOUT_MS = 3000;

interface RedisClientLike {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  disconnect(): void;
}

interface RedisServiceLike {
  isEnabled: boolean;
  getClient(): RedisClientLike | null;
  acquireLock(key: string, ttlSeconds?: number): Promise<boolean>;
}

interface GuardLike {
  canActivate(context: ExecutionContext): Promise<boolean>;
}

type HttpExceptionLike = Error & { getStatus(): number };

class GuardedController {
  @Idempotent()
  handle() {}
}

function makeContext(): ExecutionContext {
  const request = {
    headers: { 'idempotency-key': 'k-1' },
    method: 'POST',
    url: '/transaction',
    body: { title: 'Grocery' },
    user: { sub: 'user-1' },
  };
  const response = { status: jest.fn(), json: jest.fn() };

  return {
    getHandler: () => GuardedController.prototype.handle,
    getClass: () => GuardedController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

async function waitForRedisError(redis: RedisServiceLike): Promise<void> {
  const client = redis.getClient();
  if (!client) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('redis client emitted no error')),
      ERROR_EVENT_TIMEOUT_MS,
    );

    client.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('idempotency against a real unavailable redis', () => {
  let redis: RedisServiceLike;
  let client: RedisClientLike | null;
  let guard: GuardLike;
  let ServiceUnavailableException: new (
    ...args: unknown[]
  ) => HttpExceptionLike;

  beforeAll(async () => {
    process.env.REDIS_ENABLED = 'true';
    process.env.REDIS_URL = DEAD_REDIS_URL;
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh instance must re-read REDIS_ENABLED/REDIS_URL from the env
    const { RedisService } = require('./RedisService') as {
      RedisService: new (config: ConfigService) => RedisServiceLike;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must share the module registry of the service above
    const guards = require('@providers/auth/guards/Idempotency.guard') as {
      IdempotencyGuard: new (
        reflector: unknown,
        redis: RedisServiceLike,
      ) => GuardLike;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the 503 assertion needs the same registry generation as the guard
    const nestCommon = require('@nestjs/common') as {
      ServiceUnavailableException: new (
        ...args: unknown[]
      ) => HttpExceptionLike;
    };
    ServiceUnavailableException = nestCommon.ServiceUnavailableException;
    redis = new RedisService({} as ConfigService);
    client = redis.getClient();
    guard = new guards.IdempotencyGuard(new Reflector(), redis);

    await waitForRedisError(redis);
  });

  afterAll(() => {
    client?.disconnect();
    process.env.REDIS_ENABLED = 'false';
    delete process.env.REDIS_URL;
  });

  it('reports the redis client as unavailable while redis is enabled', () => {
    expect(redis.isEnabled).toBe(true);
    expect(redis.getClient()).toBeNull();
  });

  it('rejects acquireLock while redis is enabled but down', async () => {
    const result = await redis.acquireLock('lock:day').catch((e) => e);

    expect(result).not.toBe(true);
  });

  it('fails the idempotency guard with 503 while redis is enabled but down', async () => {
    const error = await guard.canActivate(makeContext()).catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
  });
});
