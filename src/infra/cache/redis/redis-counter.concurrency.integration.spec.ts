import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

const VALKEY_IMAGE = 'valkey/valkey:8.1-alpine';
const VALKEY_PORT = 6379;
const CONTAINER_START_TIMEOUT_MS = 120_000;
const READY_TIMEOUT_MS = 5000;
const READY_POLL_MS = 50;
const INITIAL = 1_700_000_000_000;

jest.setTimeout(CONTAINER_START_TIMEOUT_MS);

interface CounterService {
  readCounter(key: string, initialValue: number): Promise<number | null>;
  incrementCounter(key: string, initialValue: number): Promise<number | null>;
  ping(): Promise<boolean>;
  onModuleDestroy(): Promise<void> | void;
}

async function waitUntilReady(service: CounterService): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await service.ping()) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(`redis did not become ready within ${READY_TIMEOUT_MS} ms`);
}

describe('RedisService counters against a real valkey', () => {
  let container: StartedTestContainer;
  let service: CounterService;
  let verifier: Redis;

  beforeAll(async () => {
    container = await new GenericContainer(VALKEY_IMAGE)
      .withExposedPorts(VALKEY_PORT)
      .start();
    const url = `redis://${container.getHost()}:${container.getMappedPort(VALKEY_PORT)}`;

    process.env.REDIS_ENABLED = 'true';
    process.env.REDIS_URL = url;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the service must read the env set above
    const { RedisService } = require('./RedisService') as {
      RedisService: new (config: unknown) => CounterService;
    };
    service = new RedisService({});
    verifier = new Redis(url);
    await waitUntilReady(service);
  });

  afterAll(async () => {
    verifier?.disconnect();
    await service?.onModuleDestroy();
    await container?.stop();
  });

  it('initialises an absent key on read, then increments from the initial value', async () => {
    const key = `cache-gen:test:${randomUUID()}`;

    await expect(service.readCounter(key, INITIAL)).resolves.toBe(INITIAL);
    await expect(service.incrementCounter(key, INITIAL)).resolves.toBe(
      INITIAL + 1,
    );
    await expect(service.readCounter(key, INITIAL)).resolves.toBe(INITIAL + 1);
  });
});
