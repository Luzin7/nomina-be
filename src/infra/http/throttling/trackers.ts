import { RATE_LIMIT_CATEGORIES } from '@constants/rateLimits';
import { REFRESH_TOKEN_COOKIE, readCookie } from '@shared/utils/cookies';
import type { ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CLIENT_LIMIT_KEY } from './decorators';
import { resolveClientIp, type ClientIpSource } from './client-ip';

interface ThrottlerRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  user?: { sub?: unknown };
  body?: { email?: unknown };
}

const KEY_PART_SEPARATOR = '|';
const MISMATCH_LOG_INTERVAL_MS = 60_000;

const logger = new Logger('RateLimitClientIp');
let lastMismatchLogAt: number | undefined;

export function clearInternalKeyMismatchThrottle(): void {
  lastMismatchLogAt = undefined;
}

function reportInternalKeyMismatch(): void {
  const now = Date.now();
  const alreadyReported =
    lastMismatchLogAt !== undefined &&
    now - lastMismatchLogAt < MISMATCH_LOG_INTERVAL_MS;

  if (alreadyReported) return;

  lastMismatchLogAt = now;
  logger.warn('internal key mismatch');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildKey(
  category: string,
  parts: string[],
  source?: ClientIpSource,
): string {
  const hash = sha256(parts.join(KEY_PART_SEPARATOR));

  return source ? `${category}:${source}:${hash}` : `${category}:${hash}`;
}

export function routeOf(context: ExecutionContext): string {
  return `${context.getClass().name}.${context.getHandler().name}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function readAuthenticatedUserId(req: ThrottlerRequest) {
  const sub = req.user?.sub;

  return typeof sub === 'string' ? sub : undefined;
}

export function readEmail(req: ThrottlerRequest): string | undefined {
  const email = req.body?.email;

  return typeof email === 'string' ? email : undefined;
}

export function readRefreshToken(req: ThrottlerRequest): string | undefined {
  return readCookie(
    req.headers?.cookie as string | undefined,
    REFRESH_TOKEN_COOKIE,
  );
}

export function buildClientTracker(internalKeys: string[]) {
  return (req: ThrottlerRequest, context: ExecutionContext): string => {
    const { ip, source, keyMismatch } = resolveClientIp(
      { headers: req.headers ?? {}, socket: req.socket ?? {} },
      internalKeys,
    );
    if (keyMismatch) reportInternalKeyMismatch();

    const hasOwnBucket = Reflect.getMetadata(
      CLIENT_LIMIT_KEY,
      context.getHandler(),
    );
    const scope = hasOwnBucket ? routeOf(context) : '';

    return buildKey(RATE_LIMIT_CATEGORIES.client, [scope, ip], source);
  };
}

export function userTracker(req: ThrottlerRequest): string {
  return buildKey(RATE_LIMIT_CATEGORIES.user, [
    readAuthenticatedUserId(req) ?? '',
  ]);
}

export function refreshTokenTracker(req: ThrottlerRequest): string {
  return buildKey(RATE_LIMIT_CATEGORIES.refreshToken, [
    readRefreshToken(req) ?? '',
  ]);
}

export function accountTracker(
  req: ThrottlerRequest,
  context: ExecutionContext,
): string {
  return buildKey(RATE_LIMIT_CATEGORIES.account, [
    routeOf(context),
    normalizeEmail(readEmail(req) ?? ''),
  ]);
}

export const useTrackerAsKey = (
  _context: ExecutionContext,
  tracker: string,
): string => tracker;
