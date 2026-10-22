import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import Redis from 'ioredis';
import { RELEASE_LOCK_SCRIPT } from './RedisService';

const DEFAULT_REDIS_TEST_URL = 'redis://127.0.0.1:6380';
const REDIS_TEST_URL = process.env.REDIS_TEST_URL ?? DEFAULT_REDIS_TEST_URL;
const CONNECT_TIMEOUT_MS = 2000;
const KEY_TTL_SECONDS = 60;

const createdKeys: string[] = [];
let client: Redis | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function probeRedis(url: string): Promise<string | null> {
  const { hostname, port } = new URL(url);
  const targetPort = Number(port || 6379);

  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      socket.destroy();
      resolve(null);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(`connection to ${hostname}:${targetPort} timed out`);
    });
    socket.once('error', (error) => {
      socket.destroy();
      resolve(errorMessage(error));
    });
    socket.connect(targetPort, hostname);
  });
}

function requireClient(): Redis {
  if (!client) throw new Error('redis test client is not connected');

  return client;
}

async function releaseScript(key: string, token: string): Promise<number> {
  const redis = requireClient();

  return Number(await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token));
}

function newLockKey(state: string): string {
  const key = `lock:test:release:${state}:${randomUUID()}`;
  createdKeys.push(key);

  return key;
}

function skipWithoutRedis(): boolean {
  return client === null;
}

describe('RELEASE_LOCK_SCRIPT against a real redis', () => {
  beforeAll(async () => {
    const unreachableError = await probeRedis(REDIS_TEST_URL);
    if (unreachableError) {
      console.warn(
        `SKIPPED RELEASE_LOCK_SCRIPT spec: redis unreachable at ${REDIS_TEST_URL} (${unreachableError})`,
      );
      return;
    }

    const redis = new Redis(REDIS_TEST_URL, {
      lazyConnect: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);

    try {
      await redis.connect();
      await redis.ping();
      client = redis;
    } catch (error) {
      redis.disconnect();
      console.warn(
        `SKIPPED RELEASE_LOCK_SCRIPT spec: redis at ${REDIS_TEST_URL} did not answer (${errorMessage(error)})`,
      );
    }
  });

  afterEach(async () => {
    if (!client || createdKeys.length === 0) return;

    await client.del(...createdKeys);
    createdKeys.length = 0;
  });

  afterAll(() => {
    client?.disconnect();
  });

  it('deletes the key and returns 1 when the token matches', async () => {
    if (skipWithoutRedis()) return;

    const redis = requireClient();
    const key = newLockKey('owner');
    const token = randomUUID();
    await redis.set(key, token, 'EX', KEY_TTL_SECONDS);

    await expect(releaseScript(key, token)).resolves.toBe(1);
    await expect(redis.get(key)).resolves.toBeNull();
  });

  it('returns 0 and keeps the holder value when the token is stale', async () => {
    if (skipWithoutRedis()) return;

    const redis = requireClient();
    const key = newLockKey('stale');
    const currentToken = randomUUID();
    await redis.set(key, currentToken, 'EX', KEY_TTL_SECONDS);

    await expect(releaseScript(key, randomUUID())).resolves.toBe(0);
    await expect(redis.get(key)).resolves.toBe(currentToken);
  });

  it('lets the current holder release after a stale attempt', async () => {
    if (skipWithoutRedis()) return;

    const redis = requireClient();
    const key = newLockKey('takeover');
    const currentToken = randomUUID();
    await redis.set(key, currentToken, 'EX', KEY_TTL_SECONDS);

    await releaseScript(key, randomUUID());

    await expect(releaseScript(key, currentToken)).resolves.toBe(1);
    await expect(redis.get(key)).resolves.toBeNull();
  });
});
