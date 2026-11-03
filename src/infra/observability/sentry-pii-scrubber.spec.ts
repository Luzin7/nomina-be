import type { ErrorEvent } from '@sentry/nestjs';
import {
  scrubPii,
  scrubSpanPii,
  StreamedSpan,
  TransactionEvent,
} from './sentry-pii-scrubber';

const buildTransaction = (): TransactionEvent => ({
  type: 'transaction',
  transaction: 'GET /api/v1/report/month-summary',
  request: {
    url: 'https://api.nomina.app/api/v1/report/month-summary',
    headers: {
      'User-Agent': 'node',
      'X-Nomina-Client-Ip': '177.10.20.30',
      'x-forwarded-for': '76.76.21.21',
      'cf-connecting-ip': '76.76.21.21',
      'true-client-ip': '76.76.21.21',
      'x-real-ip': '76.76.21.21',
      forwarded: 'for=76.76.21.21',
      'x-nomina-internal-key': '[Filtered]',
    },
  },
  user: {
    id: 'user-1',
    ip_address: '76.76.21.21',
    geo: { country_code: 'BR', city: 'Sao Paulo' },
  },
  contexts: {
    trace: {
      trace_id: 't',
      span_id: 's',
      data: {
        'client.address': '76.76.21.21',
        'user.ip_address': '76.76.21.21',
        'user.geo.city': 'Sao Paulo',
        'http.client_ip': '76.76.21.21',
        'http.request.header.x-nomina-client-ip': ['177.10.20.30'],
        'http.request.header.x-forwarded-for': ['76.76.21.21'],
        'http.request.header.user-agent': ['node'],
        'http.route': '/api/v1/report/month-summary',
      },
    },
  },
  spans: [
    {
      span_id: 'c',
      trace_id: 't',
      start_timestamp: 1,
      status: 'ok',
      data: { 'client.address': '76.76.21.21', 'db.system': 'postgresql' },
    },
  ],
});

describe('scrubPii', () => {
  it('should drop IP-bearing request headers case-insensitively', () => {
    const event = scrubPii(buildTransaction());

    expect(event.request?.headers).toEqual({
      'User-Agent': 'node',
      'x-nomina-internal-key': '[Filtered]',
    });
  });

  it('should drop user ip and geo and keep the user id', () => {
    expect(scrubPii(buildTransaction()).user).toEqual({ id: 'user-1' });
  });

  it('should drop ip attributes from the trace context data', () => {
    expect(scrubPii(buildTransaction()).contexts?.trace?.data).toEqual({
      'http.request.header.user-agent': ['node'],
      'http.route': '/api/v1/report/month-summary',
    });
  });

  it('should drop ip attributes from span data', () => {
    expect(scrubPii(buildTransaction()).spans?.[0].data).toEqual({
      'db.system': 'postgresql',
    });
  });

  it('should scrub error events without request or contexts', () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { id: 'user-1', ip_address: '1.1.1.1' },
    };

    expect(scrubPii(event).user).toEqual({ id: 'user-1' });
  });

  describe('scrubSpanPii', () => {
    const span: StreamedSpan = {
      trace_id: 't',
      span_id: 's',
      name: 'GET',
      start_timestamp: 1,
      status: 'ok',
      is_segment: true,
      attributes: {
        'client.address': '76.76.21.21',
        'network.peer.address': '76.76.21.21',
        'user.ip_address': '76.76.21.21',
        'user.geo.city': 'Sao Paulo',
        'http.request.header.x-nomina-client-ip': ['177.10.20.30'],
        'http.request.header.user-agent': ['node'],
        'user.id': 'user-1',
        'workspace.id': 'ws-1',
      },
    };

    it('should drop ip and geo attributes and keep ids', () => {
      expect(scrubSpanPii(span).attributes).toEqual({
        'http.request.header.user-agent': ['node'],
        'user.id': 'user-1',
        'workspace.id': 'ws-1',
      });
    });
  });
});
