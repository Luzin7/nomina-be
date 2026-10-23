import { AccountType } from '@constants/enums';
import {
  CacheProvider,
  LockHandle,
} from '@infra/cache/contracts/CacheProvider';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { GenerateRecurringTransactionsJobService } from '@modules/transaction/jobs/generate-recurring-transactions/generate-recurring-transactions.service';
import {
  SourceAndDestinationAccountMustBeDifferentError,
  StartDateCannotBeTodayOrPastError,
} from '@modules/transaction/errors';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { NextGenerationDateCalculator } from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import { makeRecurring } from '@modules/transaction/test-helpers/mock-factories';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { UpdateRecurringTransactionService } from './update-recurring-transaction.service';

function makeAccount(overrides: { workspaceId?: string; id?: string } = {}) {
  const result = CheckingAccount.create(
    {
      workspaceId: overrides.workspaceId ?? 'ws-1',
      name: 'Account',
      type: AccountType.CHECKING,
      timezone: 'America/Sao_Paulo',
      balance: 10000n,
    },
    overrides.id ?? 'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

describe('UpdateRecurringTransactionService', () => {
  let service: UpdateRecurringTransactionService;
  let recurringRepository: jest.Mocked<RecurringTransactionRepository>;
  let accountRepository: jest.Mocked<AccountRepository>;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

  const NOW = new Date('2024-01-15T00:00:00.000Z');

  beforeEach(() => {
    recurringRepository = {
      create: jest.fn(),
      update: jest.fn().mockImplementation(async (recurring) => recurring),
      delete: jest.fn(),
      findById: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findNeedingGenerationByWorkspaceId: jest.fn(),
      listNeedingGeneration: jest.fn().mockResolvedValue([]),
      createGeneratedTransactions: jest
        .fn()
        .mockImplementation(async (transactions) => transactions.length),
    } as jest.Mocked<RecurringTransactionRepository>;

    accountRepository = {
      create: jest.fn(),
      createWithOpeningMovement: jest.fn(),
      findByNameAndWorkspaceId: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    categoryRepository = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      countByWorkspaceId: jest.fn(),
      findUniqueByAttributes: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      countChildren: jest.fn(),
      countTransactions: jest.fn(),
      reassignChildren: jest.fn(),
      findManyByIds: jest.fn(),
    } as jest.Mocked<CategoryRepository>;

    dateProvider = {
      now: jest.fn().mockReturnValue(NOW),
      add: jest.fn((date: Date, amount: number, unit: string) => {
        if (unit === 'day') return addDays(date, amount);
        if (unit === 'month') return addMonths(date, amount);
        return date;
      }),
      format: jest.fn().mockReturnValue('2024-01-15'),
      toTimezone: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn((date) => new Date(date)),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
      endOfMonth: jest.fn(),
    } as unknown as jest.Mocked<DateProvider>;

    service = new UpdateRecurringTransactionService(
      recurringRepository,
      categoryRepository,
      accountRepository,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  function makeRequest(overrides: Record<string, unknown> = {}) {
    return {
      recurringTransactionId: 'rec-1',
      workspaceId: 'ws-1',
      ...overrides,
    };
  }

  function arrangeExistingRecurring(
    overrides: Partial<Parameters<typeof makeRecurring>[0]> = {},
  ) {
    const recurring = makeRecurring({ id: 'rec-1', ...overrides });
    recurringRepository.findById.mockResolvedValue(recurring);
    accountRepository.findById.mockImplementation(async (id) =>
      id === 'acc-2' ? makeAccount({ id: 'acc-2' }) : makeAccount(),
    );
    return recurring;
  }

  function runGenerationJob(
    now: Date,
  ): GenerateRecurringTransactionsJobService {
    const redis = {
      isEnabled: true,
      exists: jest.fn().mockResolvedValue(false),
      acquireLock: jest
        .fn()
        .mockResolvedValue({ key: 'lock', token: 'token' } as LockHandle),
      releaseLock: jest.fn().mockResolvedValue(true),
      set: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CacheProvider>;

    const jobDateProvider = {
      ...dateProvider,
      now: jest.fn().mockReturnValue(now),
      add: jest.fn((date: Date, amount: number, unit: string) =>
        unit === 'day' ? addDays(date, amount) : addMonths(date, amount),
      ),
      format: jest.fn().mockReturnValue(now.toISOString().slice(0, 10)),
    } as unknown as jest.Mocked<DateProvider>;

    const calculator = {
      execute: jest.fn(
        ({ baseDate, interval }: { baseDate: Date; interval: number }) =>
          addMonths(baseDate, interval),
      ),
    } as unknown as jest.Mocked<NextGenerationDateCalculator>;

    return new GenerateRecurringTransactionsJobService(
      recurringRepository,
      calculator,
      redis,
      jobDateProvider,
    );
  }

  it('moves future generations to the new account when accountId changes', async () => {
    arrangeExistingRecurring({
      accountId: 'acc-1',
      startDate: new Date('2023-12-10'),
      lastGenerated: new Date('2024-01-10'),
    });

    const result = await service.execute(makeRequest({ accountId: 'acc-2' }));

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;
    expect(result.value.accountId).toBe('acc-2');

    recurringRepository.listNeedingGeneration.mockResolvedValue([result.value]);
    await runGenerationJob(new Date('2024-02-05T00:00:00.000Z')).execute();

    const [transactions] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions).toHaveLength(1);
    expect(transactions[0].accountId).toBe('acc-2');
  });

  it('rejects an account from another workspace', async () => {
    arrangeExistingRecurring();
    accountRepository.findById.mockImplementation(async (id) =>
      id === 'acc-2'
        ? makeAccount({ id: 'acc-2', workspaceId: 'ws-2' })
        : makeAccount(),
    );

    const result = await service.execute(makeRequest({ accountId: 'acc-2' }));

    expect(result.isLeft()).toBe(true);
    if (result.isRight()) return;
    expect(result.value).toBeInstanceOf(UnauthorizedError);
    expect(recurringRepository.update).not.toHaveBeenCalled();
  });

  it('rejects moving a transfer to the account used as its destination', async () => {
    arrangeExistingRecurring({
      type: 'TRANSFER',
      destinationAccountId: 'acc-2',
    });

    const result = await service.execute(makeRequest({ accountId: 'acc-2' }));

    expect(result.isLeft()).toBe(true);
    if (result.isRight()) return;
    expect(result.value).toBeInstanceOf(
      SourceAndDestinationAccountMustBeDifferentError,
    );
  });

  it('changes the next run when startDate changes', async () => {
    arrangeExistingRecurring({
      startDate: new Date('2024-01-01'),
      lastGenerated: new Date('2024-01-01'),
    });

    const result = await service.execute(
      makeRequest({ startDate: '2024-01-20' }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;
    expect(result.value.startDate).toEqual(new Date('2024-01-20'));
    expect(result.value.lastGenerated).toBeNull();

    recurringRepository.listNeedingGeneration.mockResolvedValue([result.value]);
    await runGenerationJob(NOW).execute();

    const [transactions] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions.map((transaction) => transaction.date)).toEqual([
      new Date('2024-01-20'),
    ]);
  });

  it('accepts resending the same startDate without validating it as future', async () => {
    arrangeExistingRecurring({
      startDate: new Date('2024-01-01'),
      lastGenerated: new Date('2024-01-10'),
    });

    const result = await service.execute(
      makeRequest({ startDate: '2024-01-01' }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;
    expect(result.value.lastGenerated).toEqual(new Date('2024-01-10'));
  });

  it('rejects a changed startDate that is today or in the past', async () => {
    arrangeExistingRecurring({ startDate: new Date('2024-01-01') });

    const result = await service.execute(
      makeRequest({ startDate: '2023-12-01' }),
    );

    expect(result.isLeft()).toBe(true);
    if (result.isRight()) return;
    expect(result.value).toBeInstanceOf(StartDateCannotBeTodayOrPastError);
  });

  it('keeps the generation anchor when only details change', async () => {
    arrangeExistingRecurring({
      lastGenerated: new Date('2024-01-10'),
      title: 'Aluguel',
    });

    const result = await service.execute(makeRequest({ title: 'Condomínio' }));

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;
    expect(result.value.title).toBe('Condomínio');
    expect(result.value.lastGenerated).toEqual(new Date('2024-01-10'));
  });

  it('does not update any transaction when validation fails', async () => {
    arrangeExistingRecurring();

    await service.execute(makeRequest({ startDate: '2020-01-01' }));

    expect(recurringRepository.update).not.toHaveBeenCalled();
  });
});
