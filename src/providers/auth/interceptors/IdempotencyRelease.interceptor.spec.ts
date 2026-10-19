import { RedisService } from '@infra/cache/redis/RedisService';
import { ExecutionContext } from '@nestjs/common';
import { CallHandler } from '@nestjs/common/interfaces';
import { firstValueFrom, throwError } from 'rxjs';
import { IdempotencyReleaseInterceptor } from './IdempotencyRelease.interceptor';

function makeContext(key = 'k-1'): ExecutionContext {
  const request = {
    headers: { 'idempotency-key': key },
    user: { sub: 'user-1' },
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeHandler(error: Error): CallHandler {
  return { handle: () => throwError(() => error) };
}

function makeInterceptor(redis: unknown): IdempotencyReleaseInterceptor {
  return new IdempotencyReleaseInterceptor(redis as RedisService);
}

describe('IdempotencyReleaseInterceptor', () => {
  it('releases the lock for the request key on failure', async () => {
    const original = new Error('handler exploded');
    const redis = {
      isEnabled: true,
      releaseLock: jest.fn().mockResolvedValue(true),
    };

    const error = await firstValueFrom(
      makeInterceptor(redis).intercept(makeContext(), makeHandler(original)),
    ).catch((e) => e);

    expect(error).toBe(original);
    expect(redis.releaseLock).toHaveBeenCalledWith('idempotency:user-1:k-1');
  });

  it('keeps the original error when the lock cannot be released', async () => {
    const original = new Error('handler exploded');
    const redis = {
      isEnabled: true,
      releaseLock: jest.fn().mockRejectedValue(new Error('redis down')),
    };

    const error = await firstValueFrom(
      makeInterceptor(redis).intercept(makeContext(), makeHandler(original)),
    ).catch((e) => e);

    expect(error).toBe(original);
  });
});
