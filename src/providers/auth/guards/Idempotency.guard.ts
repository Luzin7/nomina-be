import { LockHandle } from '@infra/cache/contracts/CacheProvider';
import { RedisService } from '@infra/cache/redis/RedisService';
import {
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  idempotencyLockOf,
  storeIdempotencyLock,
} from '../decorators/idempotencyLock';
import { idempotencyLockKey } from '../decorators/idempotencyKey';
import {
  IDEMPOTENCY_KEY,
  IdempotencyOptions,
} from '../decorators/idempotencyMetadata';

const DEFAULT_LOCK_TTL_SECONDS = 30;

@Injectable()
export class IdempotencyGuard implements CanActivate {
  private readonly logger = new Logger(IdempotencyGuard.name);

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

    if (!this.redisService.isEnabled) {
      this.logger.warn(
        'Redis is disabled. Idempotency protection is skipped for this request.',
      );
      return true;
    }

    const lock = await this.acquireLock(
      key,
      options.ttlSeconds ?? DEFAULT_LOCK_TTL_SECONDS,
    );

    if (!lock) {
      throw new ConflictException('A requisição já está sendo processada.');
    }

    storeIdempotencyLock(context, lock);
    return true;
  }

  private async acquireLock(
    key: string,
    ttlSeconds: number,
  ): Promise<LockHandle | null> {
    try {
      return await this.redisService.acquireLock(key, ttlSeconds);
    } catch (error) {
      this.logger.error(
        'Redis is enabled but unavailable. Idempotency cannot be guaranteed.',
        error,
      );
      throw new ServiceUnavailableException(
        'Não foi possível garantir a idempotência da requisição. Tente novamente em instantes.',
      );
    }
  }

  async release(context: ExecutionContext): Promise<void> {
    const lock = idempotencyLockOf(context);
    if (!lock) return;

    try {
      await this.redisService.releaseLock(lock);
    } catch (error) {
      this.logger.warn('Idempotency lock release failed', error);
    }
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
