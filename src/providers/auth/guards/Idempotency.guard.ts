import { RedisService } from '@infra/cache/redis/RedisService';
import {
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { idempotencyLockKey } from '../decorators/idempotencyKey';
import {
  IDEMPOTENCY_KEY,
  IdempotencyOptions,
} from '../decorators/idempotencyMetadata';

const DEFAULT_LOCK_TTL_SECONDS = 30;

@Injectable()
export class IdempotencyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.optionsFor(context);
    if (!options) return true;

    const key = idempotencyLockKey(context);
    if (!key) {
      throw new BadRequestException(
        'Chave de idempotência ausente no cabeçalho da requisição.',
      );
    }

    const lockAcquired = await this.redisService.acquireLock(
      key,
      options.ttlSeconds ?? DEFAULT_LOCK_TTL_SECONDS,
    );

    if (!lockAcquired) {
      throw new ConflictException('A requisição já está sendo processada.');
    }

    return true;
  }

  async release(context: ExecutionContext): Promise<void> {
    if (!this.optionsFor(context)) return;

    const key = idempotencyLockKey(context);
    if (!key) return;

    await this.redisService.releaseLock(key);
  }

  private optionsFor(
    context: ExecutionContext,
  ): IdempotencyOptions | undefined {
    return this.reflector.get<IdempotencyOptions>(
      IDEMPOTENCY_KEY,
      context.getHandler(),
    );
  }
}
