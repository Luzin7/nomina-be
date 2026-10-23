import {
  applyDecorators,
  SetMetadata,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotencyGuard } from '../guards/Idempotency.guard';
import { IdempotencyReleaseInterceptor } from '../interceptors/IdempotencyRelease.interceptor';
import { IDEMPOTENCY_KEY, IdempotencyOptions } from './idempotencyMetadata';

export { IDEMPOTENCY_KEY };
export type { IdempotencyOptions };

export const Idempotent = (options: IdempotencyOptions = {}) =>
  applyDecorators(
    SetMetadata(IDEMPOTENCY_KEY, options),
    UseGuards(IdempotencyGuard),
    UseInterceptors(IdempotencyReleaseInterceptor),
  );
