import { RATE_LIMITS, RATE_LIMIT_CATEGORIES } from '@constants/rateLimits';
import type { ExecutionContext } from '@nestjs/common';
import type {
  ThrottlerModuleOptions,
  ThrottlerOptions,
} from '@nestjs/throttler';
import { ACCOUNT_LIMIT_KEY, REFRESH_TOKEN_LIMIT_KEY } from './decorators';
import {
  accountTracker,
  buildClientTracker,
  readAuthenticatedUserId,
  readEmail,
  readRefreshToken,
  refreshTokenTracker,
  useTrackerAsKey,
  userTracker,
} from './trackers';

interface RateLimitOptionsInput {
  enforce: boolean;
  internalKeys: string[];
}

export const RATE_LIMIT_ORDER = [
  RATE_LIMIT_CATEGORIES.client,
  RATE_LIMIT_CATEGORIES.user,
  RATE_LIMIT_CATEGORIES.refreshToken,
  RATE_LIMIT_CATEGORIES.account,
] as const;

function readRequest(context: ExecutionContext) {
  return context.switchToHttp().getRequest();
}

function hasMarker(key: string, context: ExecutionContext): boolean {
  return Boolean(Reflect.getMetadata(key, context.getHandler()));
}

export function buildRateLimitOptions({
  enforce,
  internalKeys,
}: RateLimitOptionsInput): ThrottlerModuleOptions {
  const skipUnless =
    (applies: (context: ExecutionContext) => boolean) =>
    (context: ExecutionContext) =>
      !enforce || !applies(context);

  const throttlers: ThrottlerOptions[] = [
    {
      name: RATE_LIMIT_CATEGORIES.client,
      ...RATE_LIMITS.client.default,
      getTracker: buildClientTracker(internalKeys),
      generateKey: useTrackerAsKey,
      skipIf: skipUnless(
        (context) => !readAuthenticatedUserId(readRequest(context)),
      ),
    },
    {
      name: RATE_LIMIT_CATEGORIES.user,
      ...RATE_LIMITS.user,
      getTracker: userTracker,
      generateKey: useTrackerAsKey,
      skipIf: skipUnless((context) =>
        Boolean(readAuthenticatedUserId(readRequest(context))),
      ),
    },
    {
      name: RATE_LIMIT_CATEGORIES.refreshToken,
      ...RATE_LIMITS.refreshToken,
      getTracker: refreshTokenTracker,
      generateKey: useTrackerAsKey,
      skipIf: skipUnless(
        (context) =>
          hasMarker(REFRESH_TOKEN_LIMIT_KEY, context) &&
          Boolean(readRefreshToken(readRequest(context))),
      ),
    },
    {
      name: RATE_LIMIT_CATEGORIES.account,
      ...RATE_LIMITS.account.login,
      getTracker: accountTracker,
      generateKey: useTrackerAsKey,
      skipIf: skipUnless(
        (context) =>
          hasMarker(ACCOUNT_LIMIT_KEY, context) &&
          readEmail(readRequest(context)) !== undefined,
      ),
    },
  ];

  return { throttlers };
}
