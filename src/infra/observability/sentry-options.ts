import * as Sentry from '@sentry/nestjs';
import { IP_HEADER_NAMES, scrubPii, scrubSpanPii } from './sentry-pii-scrubber';

const REDIS_CACHE_PREFIXES = ['report:', 'categories:', 'workspace:'];

const HEALTH_CHECK_PATH = /^\/api\/v\d+\/health(\/ready)?\/?$/;
const HEALTH_CHECK_TRANSACTION =
  /^((GET|HEAD) \/api\/v\d+\/health(\/ready)?\/?|HealthController\..*)$/;
const HEALTH_CHECK_PATH_ATTRIBUTES = ['url.path', 'http.route', 'http.target'];

const HEALTH_CHECK_IGNORE_SPANS = [
  { attributes: { 'url.path': HEALTH_CHECK_PATH } },
  { name: /^HealthController\./ },
];

const isHealthCheckPath = (value: unknown): boolean =>
  typeof value === 'string' && HEALTH_CHECK_PATH.test(value);

const isHealthCheckSampling = (
  name: string,
  attributes: Record<string, unknown> | undefined,
): boolean => {
  if (HEALTH_CHECK_TRANSACTION.test(name)) return true;
  return HEALTH_CHECK_PATH_ATTRIBUTES.some((key) =>
    isHealthCheckPath(attributes?.[key]),
  );
};

const sampleTrace = ({
  name,
  attributes,
  inheritOrSampleWith,
}: Sentry.NodeOptions extends { tracesSampler?: (c: infer C) => unknown }
  ? C
  : never): number => {
  if (isHealthCheckSampling(name, attributes)) return 0;
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
    dataCollection: {
      userInfo: false,
      httpHeaders: { request: { deny: [...IP_HEADER_NAMES] } },
    },
    tracesSampler: sampleTrace,
    ignoreSpans: HEALTH_CHECK_IGNORE_SPANS,
    beforeSendSpan: scrubSpanPii,
    beforeSend: scrubPii,
  };
};
