import type { ErrorEvent, NodeOptions } from '@sentry/nestjs';

export type StreamedSpan = Parameters<
  NonNullable<NodeOptions['beforeSendSpan']>
>[0];

export type TransactionEvent = Parameters<
  NonNullable<NodeOptions['beforeSendTransaction']>
>[0];

export const IP_HEADER_NAMES = [
  'x-nomina-client-ip',
  'x-forwarded-for',
  'cf-connecting-ip',
  'true-client-ip',
  'x-real-ip',
  'forwarded',
] as const;

const IP_HEADERS: ReadonlySet<string> = new Set(IP_HEADER_NAMES);

const IP_ATTRIBUTES = new Set([
  'client.address',
  'client.port',
  'network.peer.address',
  'network.peer.port',
  'user.ip_address',
  'http.client_ip',
]);

const SPAN_HEADER_PREFIX = 'http.request.header.';
const GEO_ATTRIBUTE_PREFIX = 'user.geo';

const isIpAttribute = (key: string): boolean => {
  if (IP_ATTRIBUTES.has(key)) return true;
  if (key.startsWith(GEO_ATTRIBUTE_PREFIX)) return true;
  if (!key.startsWith(SPAN_HEADER_PREFIX)) return false;
  return IP_HEADERS.has(key.slice(SPAN_HEADER_PREFIX.length));
};

const omitKeys = <T extends object>(
  source: T,
  shouldOmit: (key: string) => boolean,
): T =>
  Object.fromEntries(
    Object.entries(source).filter(([key]) => !shouldOmit(key)),
  ) as T;

const scrubUser = (user: NonNullable<ErrorEvent['user']>) =>
  omitKeys(user, (key) => key === 'ip_address' || key === 'geo');

export const scrubPii = <T extends ErrorEvent | TransactionEvent>(
  event: T,
): T => {
  if (event.request?.headers) {
    event.request.headers = omitKeys(event.request.headers, (key) =>
      IP_HEADERS.has(key.toLowerCase()),
    );
  }
  if (event.user) event.user = scrubUser(event.user);
  const traceData = event.contexts?.trace?.data;
  if (traceData) {
    event.contexts!.trace!.data = omitKeys(traceData, isIpAttribute);
  }
  if ('spans' in event) {
    for (const span of event.spans ?? []) {
      if (span.data) span.data = omitKeys(span.data, isIpAttribute);
    }
  }
  return event;
};

export const scrubSpanPii = (span: StreamedSpan): StreamedSpan => ({
  ...span,
  attributes: omitKeys(span.attributes, isIpAttribute),
});
