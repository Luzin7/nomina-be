import { RATE_LIMIT_CATEGORIES } from '@constants/rateLimits';
import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { JwtAuthGuard } from '@providers/auth/guards/jwtAuth.guard';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import type { Response } from 'express';
import { RATE_LIMIT_ORDER } from './rate-limit.options';
import { routeOf } from './trackers';

const KEY_REFERENCE_LENGTH = 12;

interface KeyReference {
  category: string;
  ipSource?: string;
  reference: string;
}

function parseKey(key: string): KeyReference {
  const [category, ...rest] = key.split(':');
  const hash = rest.at(-1) ?? '';
  const ipSource =
    category === RATE_LIMIT_CATEGORIES.client ? rest[0] : undefined;

  return { category, ipSource, reference: hash.slice(0, KEY_REFERENCE_LENGTH) };
}

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly rejectionLogger = new Logger(AppThrottlerGuard.name);

  async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    this.throttlers.sort(
      (first, second) =>
        RATE_LIMIT_ORDER.indexOf(first.name as never) -
        RATE_LIMIT_ORDER.indexOf(second.name as never),
    );
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const response = context.switchToHttp().getResponse<Response>();
    response.header('Retry-After', String(detail.timeToBlockExpire));

    this.logRejection(context, detail);

    return super.throwThrottlingException(context, detail);
  }

  private logRejection(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): void {
    const { category, ipSource, reference } = parseKey(detail.key);
    const fields = [
      `category=${category}`,
      ipSource ? `ipSource=${ipSource}` : undefined,
      `route=${routeOf(context)}`,
      `limit=${detail.limit}`,
      `hits=${detail.totalHits}`,
      `retryAfterS=${detail.timeToBlockExpire}`,
      `key=${reference}`,
    ].filter(Boolean);

    this.rejectionLogger.warn(`Rate limit exceeded ${fields.join(' ')}`);
  }
}

export const APP_GUARDS = [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: AppThrottlerGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];
