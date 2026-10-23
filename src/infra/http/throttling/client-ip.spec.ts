import {
  CLIENT_IP_HEADER,
  INTERNAL_KEY_HEADER,
  resolveClientIp,
} from './client-ip';

const currentKey = 'c'.repeat(32);
const previousKey = 'p'.repeat(32);

function buildRequest(
  headers: Record<string, string> = {},
  remoteAddress = '10.0.0.9',
) {
  return { headers, socket: { remoteAddress } };
}

describe('resolveClientIp', () => {
  it('uses the forwarded client ip when the internal key matches', () => {
    const req = buildRequest({
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [INTERNAL_KEY_HEADER]: currentKey,
    });

    expect(resolveClientIp(req, [currentKey])).toEqual({
      ip: '203.0.113.7',
      source: 'internal',
    });
  });

  it('ignores the forwarded client ip without the internal key', () => {
    const req = buildRequest({ [CLIENT_IP_HEADER]: '203.0.113.7' });

    expect(resolveClientIp(req, [currentKey])).toEqual({
      ip: '10.0.0.9',
      source: 'direct',
    });
  });

  it('ignores the forwarded client ip when the internal key is wrong', () => {
    const req = buildRequest({
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [INTERNAL_KEY_HEADER]: 'w'.repeat(32),
    });

    expect(resolveClientIp(req, [currentKey])).toEqual({
      ip: '10.0.0.9',
      source: 'direct',
      keyMismatch: true,
    });
  });

  it('accepts the previous key during rotation', () => {
    const req = buildRequest({
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [INTERNAL_KEY_HEADER]: previousKey,
    });

    expect(resolveClientIp(req, [currentKey, previousKey]).source).toBe(
      'internal',
    );
  });

  it('ignores a forwarded value that is not an ip', () => {
    const req = buildRequest({
      [CLIENT_IP_HEADER]: 'not-an-ip',
      [INTERNAL_KEY_HEADER]: currentKey,
    });

    expect(resolveClientIp(req, [currentKey]).source).toBe('direct');
  });

  it('ignores x-forwarded-for', () => {
    const req = buildRequest({
      'x-forwarded-for': '203.0.113.7',
      [INTERNAL_KEY_HEADER]: currentKey,
    });

    expect(resolveClientIp(req, [currentKey])).toEqual({
      ip: '10.0.0.9',
      source: 'direct',
    });
  });

  it('never trusts the header when no key is configured', () => {
    const req = buildRequest({
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [INTERNAL_KEY_HEADER]: currentKey,
    });

    expect(resolveClientIp(req, []).source).toBe('direct');
  });

  it('keys ipv6 clients by their /64 prefix', () => {
    const first = buildRequest({}, '2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const second = buildRequest({}, '2001:0db8:0001:0002::1');
    const otherNetwork = buildRequest({}, '2001:db8:1:3::1');

    expect(resolveClientIp(first, []).ip).toBe(resolveClientIp(second, []).ip);
    expect(resolveClientIp(first, []).ip).not.toBe(
      resolveClientIp(otherNetwork, []).ip,
    );
  });

  it('treats ipv4-mapped ipv6 as ipv4', () => {
    const req = buildRequest({}, '::ffff:198.51.100.4');

    expect(resolveClientIp(req, []).ip).toBe('198.51.100.4');
  });

  it('falls back to a fixed value when the socket has no address', () => {
    const req = { headers: {}, socket: {} };

    expect(resolveClientIp(req, []).ip).toBe('unknown');
  });
});
