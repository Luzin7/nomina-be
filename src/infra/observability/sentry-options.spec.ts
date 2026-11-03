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

    it.each([
      ['GET', '/api/v1/health'],
      ['HEAD', '/api/v1/health'],
      ['GET', '/api/v2/health/ready'],
      ['GET', '/api/v1/health/'],
    ])('should not sample %s %s by url path attribute', (method, path) => {
      const { tracesSampler } = buildSentryOptions({});

      expect(
        tracesSampler?.({
          name: `${method}`,
          attributes: { 'url.path': path },
          inheritOrSampleWith: (fallback: number) => fallback,
        }),
      ).toBe(0);
    });

    it.each([
      { 'http.route': '/api/v1/health' },
      { 'http.target': '/api/v1/health/ready' },
    ])('should not sample by route attributes %p', (attributes) => {
      const { tracesSampler } = buildSentryOptions({});

      expect(
        tracesSampler?.({
          name: 'GET',
          attributes,
          inheritOrSampleWith: (fallback: number) => fallback,
        }),
      ).toBe(0);
    });

    it('should not sample the health controller handler', () => {
      expect(sample('HealthController.checkLiveness')).toBe(0);
    });

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

  it('should ignore health check segments when spans are streamed', () => {
    expect(buildSentryOptions({}).ignoreSpans).toEqual([
      { attributes: { 'url.path': /^\/api\/v\d+\/health(\/ready)?\/?$/ } },
      { name: /^HealthController\./ },
    ]);
  });

  it('should scrub IP attributes from streamed spans', () => {
    const span = buildSentryOptions({}).beforeSendSpan?.({
      trace_id: 't',
      span_id: 's',
      name: 'GET',
      start_timestamp: 1,
      status: 'ok',
      is_segment: true,
      attributes: { 'client.address': '1.1.1.1', 'user.id': 'u1' },
    });

    expect(span?.attributes).toEqual({ 'user.id': 'u1' });
  });

  describe('beforeSend', () => {
    it('should scrub PII from error events', async () => {
      const result = await buildSentryOptions({}).beforeSend?.(
        {
          type: undefined,
          user: { id: 'u1', ip_address: '1.1.1.1' },
          request: { headers: { 'x-nomina-client-ip': '1.1.1.1' } },
        },
        {},
      );

      expect(result?.user).toEqual({ id: 'u1' });
      expect(result?.request?.headers).toEqual({});
    });
  });

  it('should not collect user info nor IP headers', () => {
    expect(buildSentryOptions({}).dataCollection).toEqual({
      userInfo: false,
      httpHeaders: {
        request: {
          deny: [
            'x-nomina-client-ip',
            'x-forwarded-for',
            'cf-connecting-ip',
            'true-client-ip',
            'x-real-ip',
            'forwarded',
          ],
        },
      },
    });
  });
});
