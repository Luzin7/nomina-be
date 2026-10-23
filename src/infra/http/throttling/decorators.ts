import {
  RATE_LIMIT_CATEGORIES,
  type RateLimitRule,
} from '@constants/rateLimits';
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

export const CLIENT_LIMIT_KEY = 'rate-limit:client-override';
export const ACCOUNT_LIMIT_KEY = 'rate-limit:account';
export const REFRESH_TOKEN_LIMIT_KEY = 'rate-limit:refresh-token';

const { client, account, refreshToken } = RATE_LIMIT_CATEGORIES;

export const LimitByClient = (rule: RateLimitRule) =>
  applyDecorators(
    SetMetadata(CLIENT_LIMIT_KEY, true),
    Throttle({ [client]: rule }),
  );

export const LimitByAccount = (rule: RateLimitRule) =>
  applyDecorators(
    SetMetadata(ACCOUNT_LIMIT_KEY, true),
    Throttle({ [account]: rule }),
  );

export const LimitByRefreshToken = (rule: RateLimitRule) =>
  applyDecorators(
    SetMetadata(REFRESH_TOKEN_LIMIT_KEY, true),
    Throttle({ [refreshToken]: rule }),
  );

export const SkipAllRateLimits = () =>
  SkipThrottle(
    Object.fromEntries(
      Object.values(RATE_LIMIT_CATEGORIES).map((name) => [name, true]),
    ),
  );
