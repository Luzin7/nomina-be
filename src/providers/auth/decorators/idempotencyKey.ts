import { ExecutionContext } from '@nestjs/common';

const IDEMPOTENCY_HEADER = 'idempotency-key';

export function idempotencyLockKey(context: ExecutionContext): string | null {
  const request = context.switchToHttp().getRequest();
  const header = request.headers[IDEMPOTENCY_HEADER];
  const userId = request.user?.sub;

  if (!header || !userId) return null;

  return `idempotency:${userId}:${header}`;
}
