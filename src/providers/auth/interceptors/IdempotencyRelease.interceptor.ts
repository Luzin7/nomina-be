import { RedisService } from '@infra/cache/redis/RedisService';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, mergeMap, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { idempotencyLockKey } from '../decorators/idempotencyKey';

@Injectable()
export class IdempotencyReleaseInterceptor implements NestInterceptor {
  constructor(private readonly redisService: RedisService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error) =>
          from(this.release(context)).pipe(
            mergeMap(() => throwError(() => error)),
          ),
        ),
      );
  }

  private async release(context: ExecutionContext): Promise<void> {
    const key = idempotencyLockKey(context);
    if (!key) return;

    await this.redisService.releaseLock(key);
  }
}
