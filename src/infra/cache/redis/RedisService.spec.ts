import { ConfigService } from '@nestjs/config';
import { LockHandle } from '../contracts/CacheProvider';

const EXPECTED_RELEASE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

interface RedisClientUnderTest {
  status: string;
  on: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  eval: jest.Mock;
  exists: jest.Mock;
  ping: jest.Mock;
}

const mockClient: RedisClientUnderTest = {
  status: 'ready',
  on: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  eval: jest.fn(),
  exists: jest.fn(),
  ping: jest.fn(),
};

const mockRedisConstructor: jest.Mock = jest.fn(() => mockClient);

jest.mock('ioredis', () => ({
  __esModule: true,
  default: mockRedisConstructor,
}));

// Keeps the spec hermetic: the developer's .env must not decide which client branch is built.
jest.mock('dotenv', () => ({ config: jest.fn() }));

type RedisServiceUnderTest = {
  isEnabled: boolean;
  getClient(): unknown;
  acquireLock(key: string, ttlSeconds?: number): Promise<LockHandle | null>;
  releaseLock(lock: LockHandle): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  del(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  delByPattern(pattern: string): Promise<number>;
};

function loadRedisService(
  options: {
    enabled?: boolean;
    clientCreationFails?: boolean;
    useUrl?: boolean;
  } = {},
): RedisServiceUnderTest {
  const {
    enabled = true,
    clientCreationFails = false,
    useUrl = true,
  } = options;

  process.env.REDIS_ENABLED = String(enabled);
  delete process.env.REDIS_URL;
  if (useUrl) process.env.REDIS_URL = 'redis://127.0.0.1:6399';
  jest.resetModules();

  mockRedisConstructor.mockImplementation(() => {
    if (clientCreationFails) throw new Error('failed to create the client');

    return mockClient;
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh instance must re-read REDIS_ENABLED from the env
  const module = require('./RedisService') as {
    RedisService: new (config: ConfigService) => unknown;
  };

  return new module.RedisService({} as ConfigService) as RedisServiceUnderTest;
}

function loadRedisUnavailableError(): new (message: string) => Error {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must come from the same module registry as the service
  const module = require('./errors/RedisUnavailableError') as {
    RedisUnavailableError: new (message: string) => Error;
  };

  return module.RedisUnavailableError;
}

interface RedisOptionsUnderTest {
  commandTimeout?: number;
  connectTimeout?: number;
  enableOfflineQueue?: boolean;
  maxRetriesPerRequest?: number;
  retryStrategy?: unknown;
}

function ioredisOptions(
  callIndex: number,
  argumentIndex: number,
): RedisOptionsUnderTest {
  return mockRedisConstructor.mock.calls[callIndex][
    argumentIndex
  ] as RedisOptionsUnderTest;
}

function redisHandler(event: string): (...args: unknown[]) => void {
  const registration = mockClient.on.mock.calls.find(
    ([name]) => name === event,
  );
  if (!registration) throw new Error(`no ${event} handler registered`);

  return registration[1] as (...args: unknown[]) => void;
}

describe('RedisService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockClient.status = 'ready';
    mockClient.get.mockResolvedValue(null);
    mockClient.set.mockResolvedValue('OK');
    mockClient.del.mockResolvedValue(1);
    mockClient.eval.mockResolvedValue(0);
    mockClient.exists.mockResolvedValue(0);
    mockClient.ping.mockResolvedValue('PONG');
  });

  afterEach(() => {
    process.env.REDIS_ENABLED = 'false';
    delete process.env.REDIS_URL;
  });

  it('returns null when the lock is held by another request', async () => {
    const service = loadRedisService();
    mockClient.set.mockResolvedValue(null);

    await expect(service.acquireLock('lock:day')).resolves.toBeNull();
  });

  it('stores a unique token as the lock value with the ttl', async () => {
    const service = loadRedisService();

    const lock = await service.acquireLock('lock:day');

    expect(lock).toEqual({ key: 'lock:day', token: expect.any(String) });
    expect(lock?.token.length).toBeGreaterThan(0);
    expect(mockClient.set).toHaveBeenCalledWith(
      'lock:day',
      lock?.token,
      'EX',
      30,
      'NX',
    );
  });

  it('keeps reads fail-open while redis is enabled but unavailable', async () => {
    const service = loadRedisService({ clientCreationFails: true });

    expect(service.isEnabled).toBe(true);

    await expect(service.get('key')).resolves.toBeNull();
    await expect(service.set('key', 'value')).resolves.toBe(false);
    await expect(service.del('key')).resolves.toBe(false);
    await expect(service.exists('key')).resolves.toBe(false);
    await expect(service.delByPattern('key:*')).resolves.toBe(0);
  });

  it('does not throw on release while redis is enabled but unavailable', async () => {
    const service = loadRedisService({ clientCreationFails: true });

    await expect(
      service.releaseLock({ key: 'lock:day', token: 'token-a' }),
    ).resolves.toBe(false);
  });

  it('rejects acquireLock when SET NX fails', async () => {
    const service = loadRedisService();
    mockClient.set.mockRejectedValue(new Error('connection reset'));

    await expect(service.acquireLock('lock:day')).rejects.toThrow();
  });

  it('throws RedisUnavailableError when SET NX fails', async () => {
    const service = loadRedisService();
    const RedisUnavailableError = loadRedisUnavailableError();
    mockClient.set.mockRejectedValue(new Error('connection reset'));

    const error = await service.acquireLock('lock:day').catch((e) => e);

    expect(error).toBeInstanceOf(RedisUnavailableError);
  });

  it('rejects acquireLock when the client cannot be created', async () => {
    const service = loadRedisService({ clientCreationFails: true });

    expect(service.getClient()).toBeNull();

    await expect(service.acquireLock('lock:day')).rejects.toThrow();
  });

  it('throws RedisUnavailableError when the client cannot be created', async () => {
    const service = loadRedisService({ clientCreationFails: true });
    const RedisUnavailableError = loadRedisUnavailableError();

    const error = await service.acquireLock('lock:day').catch((e) => e);

    expect(error).toBeInstanceOf(RedisUnavailableError);
  });

  it('configures a command timeout on the ioredis client', () => {
    loadRedisService();

    const options = mockRedisConstructor.mock.calls[0][1] as {
      commandTimeout?: number;
    };

    expect(options.commandTimeout).toBeGreaterThan(0);
  });

  it('reports redis as disabled and still hands out a lock handle', async () => {
    const service = loadRedisService({ enabled: false });

    expect(service.isEnabled).toBe(false);
    expect(service.getClient()).toBeNull();

    await expect(service.acquireLock('lock:day')).resolves.toEqual({
      key: 'lock:day',
      token: expect.any(String),
    });
  });

  it('acquires the lock again after a transient redis error', async () => {
    const service = loadRedisService();
    const RedisUnavailableError = loadRedisUnavailableError();
    const onError = redisHandler('error');
    const onReady = redisHandler('ready');

    mockClient.status = 'reconnecting';
    onError(new Error('connection reset'));

    expect(service.getClient()).toBeNull();

    const error = await service.acquireLock('lock:day').catch((e) => e);
    expect(error).toBeInstanceOf(RedisUnavailableError);

    mockClient.status = 'ready';
    onReady();

    expect(service.getClient()).toBe(mockClient);
    await expect(service.acquireLock('lock:day')).resolves.toMatchObject({
      key: 'lock:day',
    });
  });

  it('keeps acquiring the lock when an error arrives on a healthy connection', async () => {
    const service = loadRedisService();
    const onError = redisHandler('error');

    onError(new Error('non-fatal protocol error'));

    expect(service.getClient()).toBe(mockClient);
    await expect(service.acquireLock('lock:day')).resolves.toMatchObject({
      key: 'lock:day',
    });
  });

  it('applies the same ioredis options on the host and port branch', () => {
    loadRedisService();
    const urlOptions = ioredisOptions(0, 1);

    loadRedisService({ useUrl: false });
    const hostOptions = ioredisOptions(1, 0);

    expect(hostOptions.commandTimeout).toBe(urlOptions.commandTimeout);
    expect(hostOptions.connectTimeout).toBe(urlOptions.connectTimeout);
    expect(hostOptions.maxRetriesPerRequest).toBe(
      urlOptions.maxRetriesPerRequest,
    );
    expect(hostOptions.enableOfflineQueue).toBe(false);
    expect(hostOptions.enableOfflineQueue).toBe(urlOptions.enableOfflineQueue);
    expect(hostOptions.retryStrategy).toEqual(expect.any(Function));
  });

  describe('lock ownership', () => {
    const store = new Map<string, string>();

    function useLockStore(): void {
      mockClient.set.mockImplementation(
        async (key: string, value: string, ...flags: string[]) => {
          if (flags.includes('NX') && store.has(key)) return null;

          store.set(key, value);
          return 'OK';
        },
      );

      mockClient.eval.mockImplementation(
        async (script: string, _keys: number, key: string, token: string) => {
          if (script !== EXPECTED_RELEASE_SCRIPT) return -1;
          if (store.get(key) !== token) return 0;

          store.delete(key);
          return 1;
        },
      );
    }

    beforeEach(() => {
      store.clear();
      useLockStore();
    });

    async function acquireRequiredLock(
      service: RedisServiceUnderTest,
      key: string,
    ): Promise<LockHandle> {
      const lock = await service.acquireLock(key);
      if (!lock) throw new Error(`lock ${key} was not acquired`);

      return lock;
    }

    it('rejects a duplicate request while the lock is held', async () => {
      const service = loadRedisService();

      const first = await service.acquireLock('lock:day');
      const second = await service.acquireLock('lock:day');

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('releases the lock it acquired and lets the key be taken again', async () => {
      const service = loadRedisService();
      const lock = await acquireRequiredLock(service, 'lock:day');

      await expect(service.releaseLock(lock)).resolves.toBe(true);
      await expect(service.acquireLock('lock:day')).resolves.toMatchObject({
        key: 'lock:day',
      });
    });

    it('releases atomically with EVAL instead of an unconditional DEL', async () => {
      const service = loadRedisService();
      const lock = await acquireRequiredLock(service, 'lock:day');

      await service.releaseLock(lock);

      expect(mockClient.eval).toHaveBeenCalledWith(
        EXPECTED_RELEASE_SCRIPT,
        1,
        'lock:day',
        lock.token,
      );
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('does not delete the lock when the acquiring token has expired', async () => {
      const service = loadRedisService();
      const staleLock = await acquireRequiredLock(service, 'lock:day');

      store.clear();
      const currentLock = await acquireRequiredLock(service, 'lock:day');
      expect(currentLock.token).not.toEqual(staleLock.token);

      await expect(service.releaseLock(staleLock)).resolves.toBe(false);
      expect(store.get('lock:day')).toBe(currentLock.token);
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('still releases the lock for the current holder after a stale release', async () => {
      const service = loadRedisService();
      const staleLock = await acquireRequiredLock(service, 'lock:day');

      store.clear();
      const currentLock = await acquireRequiredLock(service, 'lock:day');

      await service.releaseLock(staleLock);

      await expect(service.releaseLock(currentLock)).resolves.toBe(true);
      expect(store.has('lock:day')).toBe(false);
    });
  });
});
