import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions } from './sentry-options';

jest.mock('@sentry/nestjs', () => {
  const actual = jest.requireActual('@sentry/nestjs');
  return {
    ...actual,
    redisIntegration: jest.fn(actual.redisIntegration),
  };
});

describe('buildSentryOptions', () => {
  it('should use APP_VERSION as release', () => {
    const options = buildSentryOptions({
      APP_VERSION: '1.4.0',
      GIT_SHA: 'abc123',
    });

    expect(options.release).toBe('nomina-be@1.4.0');
  });

  it('should fall back to GIT_SHA as release', () => {
    const options = buildSentryOptions({ GIT_SHA: 'abc123' });

    expect(options.release).toBe('abc123');
  });

  it('should leave release undefined without version or sha', () => {
    expect(buildSentryOptions({}).release).toBeUndefined();
  });

  it('should register the Redis integration', () => {
    const names = (
      buildSentryOptions({}).integrations as { name: string }[]
    ).map((integration) => integration.name);

    expect(names).toContain('Redis');
  });

  it('should set environment from NODE_ENV', () => {
    const options = buildSentryOptions({ NODE_ENV: 'production' });

    expect(options.environment).toBe('production');
  });

  describe('tracesSampler', () => {
    const sample = (name: string, env: NodeJS.ProcessEnv = {}) => {
      const { tracesSampler } = buildSentryOptions(env);
      return tracesSampler?.({
        name,
        attributes: {},
        inheritOrSampleWith: (fallback: number) => fallback,
      });
    };

    it.each(['GET /api/v1/health', 'GET /api/v1/health/ready'])(
      'should not sample %s',
      (name) => {
        expect(sample(name)).toBe(0);
      },
    );

    it('should sample regular requests', () => {
      expect(sample('GET /api/v1/report/month-summary')).toBe(1);
    });

    it('should sample regular requests in production', () => {
      expect(
        sample('GET /api/v1/report/month-summary', { NODE_ENV: 'production' }),
      ).toBe(1);
    });

    it('should inherit the parent sampling decision', () => {
      const { tracesSampler } = buildSentryOptions({});

      expect(
        tracesSampler?.({
          name: 'GET /api/v1/report/month-summary',
          attributes: {},
          inheritOrSampleWith: () => 0,
        }),
      ).toBe(0);
    });
  });

  it('should not enable profiling', () => {
    const options = buildSentryOptions({ NODE_ENV: 'production' });
    const names = (options.integrations as { name: string }[]).map(
      (integration) => integration.name,
    );

    expect(names).toEqual(['Redis']);
    expect(options.profileSessionSampleRate).toBeUndefined();
    expect(options.profileLifecycle).toBeUndefined();
  });

  it('should enable only with a DSN', () => {
    expect(
      buildSentryOptions({ SENTRY_DSN: 'https://k@o.ingest/1' }).enabled,
    ).toBe(true);
    expect(buildSentryOptions({}).enabled).toBe(false);
  });

  it('should configure Redis cache prefixes', () => {
    buildSentryOptions({});

    expect(Sentry.redisIntegration).toHaveBeenCalledWith({
      cachePrefixes: ['report:', 'categories:', 'workspace:'],
    });
  });
});
