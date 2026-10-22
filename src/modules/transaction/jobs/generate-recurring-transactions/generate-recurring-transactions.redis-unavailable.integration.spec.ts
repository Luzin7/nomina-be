import { DateProvider } from '@providers/date/contracts/DateProvider';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { captureException } from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { NextGenerationDateCalculator } from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import { GenerateRecurringTransactionsJobService } from './generate-recurring-transactions.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const mockCaptureException = captureException as jest.MockedFunction<
  typeof captureException
>;

const DEAD_REDIS_URL = 'redis://127.0.0.1:6399';
const ERROR_EVENT_TIMEOUT_MS = 3000;

interface RedisClientLike {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  disconnect(): void;
}

interface RedisServiceLike {
  isEnabled: boolean;
  getClient(): RedisClientLike | null;
  acquireLock(key: string, ttlSeconds?: number): Promise<unknown>;
}

async function waitForRedisError(redis: RedisServiceLike): Promise<void> {
  const client = redis.getClient();
  if (!client) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('redis client emitted no error')),
      ERROR_EVENT_TIMEOUT_MS,
    );

    client.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('GenerateRecurringTransactionsJobService against a real unavailable redis', () => {
  let redis: RedisServiceLike;
  let client: RedisClientLike | null;
  let recurringRepository: jest.Mocked<RecurringTransactionRepository>;
  let nextGenerationDateCalculator: jest.Mocked<NextGenerationDateCalculator>;
  let dateProvider: jest.Mocked<DateProvider>;
  let service: GenerateRecurringTransactionsJobService;

  beforeAll(async () => {
    process.env.REDIS_ENABLED = 'true';
    process.env.REDIS_URL = DEAD_REDIS_URL;
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh instance must re-read REDIS_ENABLED/REDIS_URL from the env
    const { RedisService } = require('@infra/cache/redis/RedisService') as {
      RedisService: new (config: ConfigService) => RedisServiceLike;
    };

    redis = new RedisService({} as ConfigService);
    client = redis.getClient();

    await waitForRedisError(redis);
  });

  beforeEach(() => {
    recurringRepository = {
      listNeedingGeneration: jest.fn().mockResolvedValue([]),
      createGeneratedTransactions: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<RecurringTransactionRepository>;

    nextGenerationDateCalculator = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<NextGenerationDateCalculator>;

    dateProvider = {
      now: jest.fn().mockReturnValue(new Date('2024-01-15T00:00:00.000Z')),
      add: jest.fn().mockReturnValue(new Date('2024-01-22')),
      format: jest.fn().mockReturnValue('2024-01-15'),
    } as unknown as jest.Mocked<DateProvider>;

    service = new GenerateRecurringTransactionsJobService(
      recurringRepository,
      nextGenerationDateCalculator,
      redis as unknown as CacheProvider,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  afterAll(() => {
    client?.disconnect();
    process.env.REDIS_ENABLED = 'false';
    delete process.env.REDIS_URL;
  });

  it('skips generation while redis is enabled but down', async () => {
    await service.execute();

    expect(recurringRepository.listNeedingGeneration).not.toHaveBeenCalled();
  });

  it('returns left and reports while redis is enabled but down', async () => {
    const result = await service.execute();

    expect(result.isLeft()).toBe(true);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });
});
