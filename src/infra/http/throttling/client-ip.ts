import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const CLIENT_IP_HEADER = 'x-nomina-client-ip';
export const INTERNAL_KEY_HEADER = 'x-nomina-internal-key';

const UNKNOWN_IP = 'unknown';
const IPV4_MAPPED_PREFIX = '::ffff:';
const IPV6_GROUP_COUNT = 8;
const IPV6_PREFIX_GROUPS = 4;
const IPV4_MAPPED_SEGMENT = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export type ClientIpSource = 'internal' | 'direct';

export interface ResolvedClientIp {
  ip: string;
  source: ClientIpSource;
  keyMismatch?: true;
}

interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function matchesAnyKey(candidate: string, acceptedKeys: string[]): boolean {
  const candidateDigest = digest(candidate);
  let matched = false;

  for (const key of acceptedKeys) {
    if (timingSafeEqual(candidateDigest, digest(key))) matched = true;
  }

  return matched;
}

function expandIpv6Groups(address: string): string[] {
  if (!address.includes('::')) return address.split(':');

  const [head, tail] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const ipv4TailGroups = tailGroups.at(-1)?.includes('.') ? 1 : 0;
  const zeroGroups =
    IPV6_GROUP_COUNT - headGroups.length - tailGroups.length - ipv4TailGroups;

  return [...headGroups, ...Array<string>(zeroGroups).fill('0'), ...tailGroups];
}

function normalizeIp(rawAddress: string): string {
  const address = rawAddress.split('%')[0].toLowerCase();
  const mapped = IPV4_MAPPED_SEGMENT.exec(address);

  if (mapped) return mapped[1];
  if (address.startsWith(IPV4_MAPPED_PREFIX)) return address;
  if (isIP(address) !== 6) return address;

  const prefix = expandIpv6Groups(address)
    .slice(0, IPV6_PREFIX_GROUPS)
    .map((group) => Number.parseInt(group, 16).toString(16));

  return `${prefix.join(':')}::/64`;
}

function readHeader(req: ClientIpRequest, name: string): string | undefined {
  const value = req.headers[name];

  return typeof value === 'string' ? value : undefined;
}

function resolveDirect(req: ClientIpRequest): ResolvedClientIp {
  const remoteAddress = req.socket.remoteAddress;

  return {
    ip: remoteAddress ? normalizeIp(remoteAddress) : UNKNOWN_IP,
    source: 'direct',
  };
}

export function resolveClientIp(
  req: ClientIpRequest,
  acceptedKeys: string[],
): ResolvedClientIp {
  const presentedKey = readHeader(req, INTERNAL_KEY_HEADER);
  const forwardedIp = readHeader(req, CLIENT_IP_HEADER);

  if (!presentedKey) return resolveDirect(req);
  if (!matchesAnyKey(presentedKey, acceptedKeys)) {
    return { ...resolveDirect(req), keyMismatch: true };
  }
  if (!forwardedIp || !isIP(forwardedIp)) return resolveDirect(req);

  return { ip: normalizeIp(forwardedIp), source: 'internal' };
}
