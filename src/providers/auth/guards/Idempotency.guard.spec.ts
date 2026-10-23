import { LockHandle } from '@infra/cache/contracts/CacheProvider';
import { RedisService } from '@infra/cache/redis/RedisService';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { Idempotent } from '../decorators/Idempotency.decorator';
import { IdempotencyGuard } from './Idempotency.guard';

const loggerWarn = jest
  .spyOn(Logger.prototype, 'warn')
  .mockImplementation(() => undefined);
const loggerError = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

function loggedIdempotencyDegradation(): boolean {
  return [...loggerWarn.mock.calls, ...loggerError.mock.calls].some(
    ([message]) => /idempot/i.test(String(message)),
  );
}

class FakeRedisService {
  readonly isEnabled = true;
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<boolean> {
    this.store.set(key, value);
    return true;
  }

  async del(key: string): Promise<boolean> {
    this.store.delete(key);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async acquireLock(key: string): Promise<LockHandle | null> {
    if (this.store.has(key)) return null;

    const token = randomUUID();
    this.store.set(key, token);
    return { key, token };
  }

  async releaseLock(lock: LockHandle): Promise<boolean> {
    if (this.store.get(lock.key) !== lock.token) return false;

    this.store.delete(lock.key);
    return true;
  }
}

class GuardedController {
  @Idempotent()
  handle() {}
}

type ReleasableGuard = IdempotencyGuard & {
  release(context: ExecutionContext): Promise<void>;
};

function makeGuard(redis: unknown): IdempotencyGuard {
  return new IdempotencyGuard(new Reflector(), redis as RedisService);
}

function makeContext(overrides: { key?: string } = {}): ExecutionContext {
  const headers: Record<string, string> = {};
  if (overrides.key !== undefined) headers['idempotency-key'] = overrides.key;

  const request = {
    headers,
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

describe('IdempotencyGuard', () => {
  let guard: IdempotencyGuard;

  beforeEach(() => {
    guard = makeGuard(new FakeRedisService());
  });

  it('rejects a request without the idempotency-key header with 400', async () => {
    const error = await guard.canActivate(makeContext()).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
  });

  it('allows the first request when the key is free', async () => {
    await expect(guard.canActivate(makeContext({ key: 'k-1' }))).resolves.toBe(
      true,
    );
  });

  it('rejects a duplicate with the same key while it is held with 409', async () => {
    await guard.canActivate(makeContext({ key: 'k-1' }));

    const error = await guard
      .canActivate(makeContext({ key: 'k-1' }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error).not.toBeInstanceOf(UnprocessableEntityException);
    expect(error.getStatus()).toBe(409);
  });

  it('allows two different keys', async () => {
    await expect(guard.canActivate(makeContext({ key: 'k-1' }))).resolves.toBe(
      true,
    );
    await expect(guard.canActivate(makeContext({ key: 'k-2' }))).resolves.toBe(
      true,
    );
  });

  it('rejects with 409 when another instance already holds the key', async () => {
    const redis = {
      isEnabled: true,
      get: jest.fn().mockResolvedValue(null),
      acquireLock: jest.fn().mockResolvedValue(null),
      releaseLock: jest.fn(),
    };

    const error = await makeGuard(redis)
      .canActivate(makeContext({ key: 'held-elsewhere' }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getStatus()).toBe(409);
  });

  it('fails closed with 503 when redis is enabled but unavailable', async () => {
    const redis = {
      isEnabled: true,
      acquireLock: jest.fn().mockRejectedValue(new Error('redis down')),
      releaseLock: jest.fn(),
    };

    const error = await makeGuard(redis)
      .canActivate(makeContext({ key: 'k-1' }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
  });

  it('does not pass the request through when the lock call fails unexpectedly', async () => {
    const redis = {
      isEnabled: true,
      acquireLock: jest.fn().mockRejectedValue(new Error('socket hang up')),
      releaseLock: jest.fn(),
    };

    const error = await makeGuard(redis)
      .canActivate(makeContext({ key: 'k-1' }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(Error);
  });

  it('allows a retry with the same key after the guarded handler fails', async () => {
    const context = makeContext({ key: 'k-1' });
    const releasable = guard as ReleasableGuard;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    await releasable.release(context);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('passes through with a degradation log when redis is disabled', async () => {
    const redis = new RedisService({} as ConfigService);
    guard = makeGuard(redis);

    expect((redis as unknown as { isEnabled: boolean }).isEnabled).toBe(false);
    expect(redis.getClient()).toBeNull();

    await expect(guard.canActivate(makeContext({ key: 'k-1' }))).resolves.toBe(
      true,
    );
    expect(loggedIdempotencyDegradation()).toBe(true);
  });
});
