import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringTransactionNotFoundError } from '@modules/transaction/errors';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { makeRecurring } from '@modules/transaction/test-helpers/mock-factories';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { ToggleActiveRecurringTransactionService } from './toggle-active-recurring-transaction.service';

describe('ToggleActiveRecurringTransactionService', () => {
  let service: ToggleActiveRecurringTransactionService;
  let recurringRepository: jest.Mocked<RecurringTransactionRepository>;
  let cacheProvider: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    recurringRepository = {
      create: jest.fn(),
      update: jest.fn().mockImplementation(async (recurring) => recurring),
      delete: jest.fn(),
      findById: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findNeedingGenerationByWorkspaceId: jest.fn(),
      listNeedingGeneration: jest.fn(),
      createGeneratedTransactions: jest.fn(),
    } as jest.Mocked<RecurringTransactionRepository>;

    cacheProvider = {
      delByPattern: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<CacheProvider>;

    service = new ToggleActiveRecurringTransactionService(
      recurringRepository,
      cacheProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  const request = { recurringTransactionId: 'rec-1', workspaceId: 'ws-1' };

  it('should clear the report cache once after toggling', async () => {
    recurringRepository.findById.mockResolvedValue(
      makeRecurring({ id: 'rec-1' }),
    );

    const result = await service.execute(request);

    expect(result.isRight()).toBe(true);
    expect(cacheProvider.delByPattern).toHaveBeenCalledTimes(1);
    expect(cacheProvider.delByPattern).toHaveBeenCalledWith('report:*:ws-1:*');
  });

  it('should not clear the report cache when the recurrence is not found', async () => {
    recurringRepository.findById.mockResolvedValue(null);

    const result = await service.execute(request);

    expect(result.value).toBeInstanceOf(RecurringTransactionNotFoundError);
    expect(cacheProvider.delByPattern).not.toHaveBeenCalled();
  });

  it('should not clear the report cache when the recurrence belongs to another workspace', async () => {
    recurringRepository.findById.mockResolvedValue(
      makeRecurring({ id: 'rec-1', workspaceId: 'ws-2' }),
    );

    const result = await service.execute(request);

    expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(cacheProvider.delByPattern).not.toHaveBeenCalled();
  });
});
