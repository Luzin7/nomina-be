import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AccountNotFoundError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { RecurringTransactionNotFoundError } from '@modules/transaction/errors';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { makeRecurring } from '@modules/transaction/test-helpers/mock-factories';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { DeleteRecurringTransactionService } from './delete-recurring-transaction.service';

describe('DeleteRecurringTransactionService', () => {
  let service: DeleteRecurringTransactionService;
  let recurringRepository: jest.Mocked<RecurringTransactionRepository>;
  let accountRepository: jest.Mocked<AccountRepository>;
  let dateProvider: jest.Mocked<DateProvider>;
  let cacheProvider: jest.Mocked<CacheProvider>;
  let calls: string[];

  const now = new Date('2026-03-15T12:00:00.000Z');
  const todayStart = new Date('2026-03-15T03:00:00.000Z');

  beforeEach(() => {
    calls = [];

    recurringRepository = {
      create: jest.fn(),
      update: jest.fn().mockImplementation(async (recurring) => recurring),
      deleteWithFuturePendingOccurrences: jest
        .fn()
        .mockImplementation(async () => {
          calls.push('delete');
        }),
      findById: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findNeedingGenerationByWorkspaceId: jest.fn(),
      listNeedingGeneration: jest.fn(),
      createGeneratedTransactions: jest.fn(),
      findSummaryRules: jest.fn(),
      findCompletedRecurringExpense: jest.fn(),
    } as jest.Mocked<RecurringTransactionRepository>;

    accountRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<AccountRepository>;

    dateProvider = {
      now: jest.fn().mockReturnValue(now),
      startOfDay: jest.fn().mockReturnValue(todayStart),
    } as unknown as jest.Mocked<DateProvider>;

    cacheProvider = {
      delByPattern: jest.fn().mockResolvedValue(0),
      incrementCounter: jest.fn().mockImplementation(async () => {
        calls.push('invalidate');
        return 1;
      }),
    } as unknown as jest.Mocked<CacheProvider>;

    service = new DeleteRecurringTransactionService(
      recurringRepository,
      accountRepository,
      dateProvider,
      cacheProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  const request = { recurringTransactionId: 'rec-1', workspaceId: 'ws-1' };

  describe('when the rule exists in the workspace', () => {
    beforeEach(() => {
      recurringRepository.findById.mockResolvedValue(
        makeRecurring({ id: 'rec-1' }),
      );
      accountRepository.findById.mockResolvedValue(
        makeCheckingAccount({ id: 'acc-1', timezone: 'America/Sao_Paulo' }),
      );
    });

    it('should delete the rule with the account-local start of today', async () => {
      await service.execute(request);

      expect(accountRepository.findById).toHaveBeenCalledWith('acc-1');
      expect(dateProvider.startOfDay).toHaveBeenCalledWith(
        now,
        'America/Sao_Paulo',
      );
      expect(
        recurringRepository.deleteWithFuturePendingOccurrences,
      ).toHaveBeenCalledWith('rec-1', {
        workspaceId: 'ws-1',
        timezone: 'America/Sao_Paulo',
        todayStart,
      });
    });

    it('should delete before clearing the ledger cache', async () => {
      await service.execute(request);

      expect(calls).toEqual(['delete', 'invalidate']);
    });

    it('should clear the report cache once after deleting', async () => {
      const result = await service.execute(request);

      expect(result.isRight()).toBe(true);
      expect(cacheProvider.incrementCounter).toHaveBeenCalledWith(
        'cache-gen:report:ws-1',
        expect.any(Number),
      );
      expect(cacheProvider.delByPattern).not.toHaveBeenCalled();
    });
  });

  it('should do nothing when the rule is not found', async () => {
    recurringRepository.findById.mockResolvedValue(null);

    const result = await service.execute(request);

    expect(result.value).toBeInstanceOf(RecurringTransactionNotFoundError);
    expect(
      recurringRepository.deleteWithFuturePendingOccurrences,
    ).not.toHaveBeenCalled();
    expect(accountRepository.findById).not.toHaveBeenCalled();
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('should do nothing when the rule belongs to another workspace', async () => {
    recurringRepository.findById.mockResolvedValue(
      makeRecurring({ id: 'rec-1', workspaceId: 'ws-2' }),
    );

    const result = await service.execute(request);

    expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(
      recurringRepository.deleteWithFuturePendingOccurrences,
    ).not.toHaveBeenCalled();
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('should fail when the rule account is missing', async () => {
    recurringRepository.findById.mockResolvedValue(
      makeRecurring({ id: 'rec-1' }),
    );
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(request);

    expect(result.value).toBeInstanceOf(AccountNotFoundError);
    expect(
      recurringRepository.deleteWithFuturePendingOccurrences,
    ).not.toHaveBeenCalled();
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });
});
