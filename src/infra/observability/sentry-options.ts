import * as Sentry from '@sentry/nestjs';

const REDIS_CACHE_PREFIXES = ['report:', 'categories:', 'workspace:'];

const HEALTH_CHECK_TRANSACTION = /^GET \/api\/v\d+\/health(\/ready)?\/?$/;

const sampleTrace = ({
  name,
  inheritOrSampleWith,
}: Sentry.NodeOptions extends { tracesSampler?: (c: infer C) => unknown }
  ? C
  : never): number => {
  if (HEALTH_CHECK_TRANSACTION.test(name)) return 0;
  return inheritOrSampleWith(1);
};

const resolveRelease = (env: NodeJS.ProcessEnv): string | undefined => {
  if (env.APP_VERSION) return `nomina-be@${env.APP_VERSION}`;
  return env.GIT_SHA || undefined;
};

export const buildSentryOptions = (
  env: NodeJS.ProcessEnv,
): Sentry.NodeOptions => {
  return {
    dsn: env.SENTRY_DSN,
    enabled: !!env.SENTRY_DSN,
    release: resolveRelease(env),
    environment: env.NODE_ENV,
    integrations: [
      Sentry.redisIntegration({ cachePrefixes: REDIS_CACHE_PREFIXES }),
    ],
    tracesSampler: sampleTrace,
  };
};
