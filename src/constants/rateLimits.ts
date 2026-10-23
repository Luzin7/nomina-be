const ONE_MINUTE_MS = 60_000;
const FIFTEEN_MINUTES_MS = 15 * ONE_MINUTE_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

export interface RateLimitRule {
  limit: number;
  ttl: number;
}

export const RATE_LIMITS = {
  user: { limit: 600, ttl: ONE_MINUTE_MS },
  client: {
    default: { limit: 60, ttl: ONE_MINUTE_MS },
    login: { limit: 20, ttl: ONE_MINUTE_MS },
    createUser: { limit: 10, ttl: ONE_HOUR_MS },
  },
  account: {
    login: { limit: 10, ttl: FIFTEEN_MINUTES_MS },
    createUser: { limit: 5, ttl: ONE_HOUR_MS },
  },
  refreshToken: { limit: 20, ttl: ONE_MINUTE_MS },
} as const satisfies Record<
  string,
  RateLimitRule | Record<string, RateLimitRule>
>;

export const RATE_LIMIT_CATEGORIES = {
  client: 'client',
  user: 'user',
  refreshToken: 'refresh-token',
  account: 'account',
} as const;
