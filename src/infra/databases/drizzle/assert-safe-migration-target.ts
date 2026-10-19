import { UnsafeMigrationTargetError } from './errors/UnsafeMigrationTargetError';

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'host.docker.internal',
  'postgres',
  'db',
]);

const LOCAL_HOST_SUFFIXES = ['.localhost', '.local'];

type SafeMigrationTargetInput = {
  databaseUrl: string;
  allowProd: boolean;
};

export function assertSafeMigrationTarget({
  databaseUrl,
  allowProd,
}: SafeMigrationTargetInput): void {
  const host = extractHost(databaseUrl);

  if (allowProd) return;
  if (isLocalHost(host)) return;

  throw new UnsafeMigrationTargetError(host);
}

export function allowRemoteMigrationTarget(env: NodeJS.ProcessEnv): boolean {
  if (env.ALLOW_PROD_MIGRATE === '1') return true;

  return env.CI === 'true';
}

function extractHost(databaseUrl: string): string {
  const { hostname } = parseDatabaseUrl(databaseUrl);
  if (!hostname) throw new UnsafeMigrationTargetError('missing hostname');

  return normalizeHost(hostname);
}

function parseDatabaseUrl(databaseUrl: string): URL {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new UnsafeMigrationTargetError('unparseable DATABASE_URL');
  }
}

function normalizeHost(host: string): string {
  return host
    .replace(/\.$/, '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

function isLocalHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) return true;

  return LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
