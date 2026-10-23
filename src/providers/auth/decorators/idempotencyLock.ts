import { LockHandle } from '@infra/cache/contracts/CacheProvider';
import { ExecutionContext } from '@nestjs/common';

interface IdempotencyRequest {
  idempotencyLock?: LockHandle;
}

export function storeIdempotencyLock(
  context: ExecutionContext,
  lock: LockHandle,
): void {
  const request = context.switchToHttp().getRequest<IdempotencyRequest>();
  request.idempotencyLock = lock;
}

export function idempotencyLockOf(
  context: ExecutionContext,
): LockHandle | null {
  const request = context.switchToHttp().getRequest<IdempotencyRequest>();
  return request.idempotencyLock ?? null;
}
