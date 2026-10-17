import { RedisService } from '@infra/cache/redis/RedisService';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Idempotent } from '../decorators/Idempotency.decorator';
import { IdempotencyGuard } from './Idempotency.guard';

class FakeRedisService {
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

  async acquireLock(key: string): Promise<boolean> {
    if (this.store.has(key)) return false;

    this.store.set(key, '1');
    return true;
  }

  async releaseLock(key: string): Promise<boolean> {
    this.store.delete(key);
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
      get: jest.fn().mockResolvedValue(null),
      acquireLock: jest.fn().mockResolvedValue(false),
      releaseLock: jest.fn(),
    };

    const error = await makeGuard(redis)
      .canActivate(makeContext({ key: 'held-elsewhere' }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getStatus()).toBe(409);
  });

  it('allows a retry with the same key after the guarded handler fails', async () => {
    const context = makeContext({ key: 'k-1' });
    const releasable = guard as ReleasableGuard;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    await releasable.release(context);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('passes through when redis is disabled', async () => {
    const redis = new RedisService({} as ConfigService);
    guard = makeGuard(redis);

    expect(redis.getClient()).toBeNull();

    await expect(guard.canActivate(makeContext({ key: 'k-1' }))).resolves.toBe(
      true,
    );
  });
});
