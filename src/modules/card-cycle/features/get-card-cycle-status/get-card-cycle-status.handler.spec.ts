import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AccountTypeError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { TransactionStatus, TransactionType } from '@constants/enums';
import { CardCycleNotConfiguredError } from '@modules/card-cycle/errors';
import {
  CardCycleBudgetRecord,
  CardCyclePeriodRecord,
  CardCycleRepository,
  MaterializeCardCyclePeriodInput,
} from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { GetCardCycleStatusService } from './get-card-cycle-status.handler';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const SAO_PAULO = 'America/Sao_Paulo';

type LedgerRow = {
  accountId: string;
  categoryId: string;
  amount: number;
  date: Date;
  type: TransactionType;
  status: TransactionStatus;
};

function makePeriod(
  overrides: Partial<CardCyclePeriodRecord> = {},
): CardCyclePeriodRecord {
  return {
    id: 'period-1',
    workspaceId: 'ws-1',
    accountId: 'acc-1',
    dueDate: '2026-12-28',
    periodStart: '2026-11-22',
    periodEnd: '2026-12-21',
    dueDay: 28,
    closingDaysBeforeDue: 7,
    materializedAt: new Date('2026-11-20T12:00:00.000Z'),
    ...overrides,
  };
}

function makeBudget(
  limitCents: number,
  overrides: Partial<CardCycleBudgetRecord> = {},
): CardCycleBudgetRecord {
  return {
    id: 'budget-1',
    workspaceId: 'ws-1',
    accountId: 'acc-1',
    effectiveFrom: '2026-12-28',
    limitCents,
    ...overrides,
  };
}

function makeCardWithoutDueDay(): CreditCard {
  return CreditCard.reconstitute(
    {
      workspaceId: 'ws-1',
      name: 'My Card',
      timezone: SAO_PAULO,
      balance: 0n,
      creditLimit: 500_000n,
      closingDaysBeforeDue: 7,
      dueDay: null,
      autoPayEnabled: false,
      autoPayConfirmedAt: null,
      autoPayEnabledAt: null,
      autoPaySourceAccountId: null,
    },
    'acc-1',
  );
}

const localDateOf = (date: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);

const saoPauloNoonOf = (date: string): Date =>
  new Date(`${date}T15:00:00.000Z`);

function makeLedgerRepository(
  rows: LedgerRow[],
  budgets: CardCycleBudgetRecord[],
): CardCycleRepository {
  return {
    materializePeriod: async (input) => makePeriod({ ...input.window }),
    findPeriod: async () => null,
    findApplicableBudget: async (_workspaceId, _accountId, dueDate) =>
      budgets
        .filter((budget) => budget.effectiveFrom <= dueDate)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
        .at(-1) ?? null,
    saveBudget: async () => {
      throw new Error('The status service does not save limits.');
    },
    listPeriods: async () => [],
    sumCycleSpend: async (input) =>
      rows
        .filter(
          (row) =>
            row.accountId === input.accountId &&
            row.type === TransactionType.EXPENSE &&
            row.status === TransactionStatus.COMPLETED &&
            localDateOf(row.date, input.timezone) >= input.periodStart &&
            localDateOf(row.date, input.timezone) <= input.periodEnd,
        )
        .reduce((total, row) => total + row.amount, 0),
  };
}

function makeStatusService(
  cardCycleRepository: CardCycleRepository,
  dateProvider: DayJsDateProvider,
  cardOverrides: { dueDay?: number } = {},
): GetCardCycleStatusService {
  const accountRepository = {
    findById: jest.fn().mockResolvedValue(
      makeCreditCard({
        dueDay: 28,
        closingDaysBeforeDue: 7,
        ...cardOverrides,
      }),
    ),
  } as unknown as jest.Mocked<AccountRepository>;

  return new GetCardCycleStatusService(
    accountRepository,
    cardCycleRepository,
    dateProvider,
  );
}

describe('GetCardCycleStatusService', () => {
  let service: GetCardCycleStatusService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let cardCycleRepository: jest.Mocked<CardCycleRepository>;
  let dateProvider: DayJsDateProvider;
  let card: CreditCard;

  beforeEach(() => {
    card = makeCreditCard({ dueDay: 28, closingDaysBeforeDue: 7 });

    accountRepository = {
      findById: jest.fn().mockResolvedValue(card),
    } as unknown as jest.Mocked<AccountRepository>;

    cardCycleRepository = {
      materializePeriod: jest.fn().mockResolvedValue(makePeriod()),
      findPeriod: jest.fn(),
      findApplicableBudget: jest.fn().mockResolvedValue(null),
      saveBudget: jest.fn(),
      listPeriods: jest.fn(),
      sumCycleSpend: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<CardCycleRepository>;

    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new GetCardCycleStatusService(
      accountRepository,
      cardCycleRepository,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('materializes the requested cycle and returns limit, spend and available', async () => {
    cardCycleRepository.findApplicableBudget.mockResolvedValue(
      makeBudget(250_000),
    );
    cardCycleRepository.sumCycleSpend.mockResolvedValue(100_000);

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      dueDate: '2026-12-28',
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value).toEqual({
      accountId: 'acc-1',
      dueDate: '2026-12-28',
      periodStart: '2026-11-22',
      periodEnd: '2026-12-21',
      limitCents: 250_000,
      cycleSpendCents: 100_000,
      availableCents: 150_000,
      materializedAt: new Date('2026-11-20T12:00:00.000Z'),
    });
    expect(cardCycleRepository.materializePeriod).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      window: {
        dueDate: '2026-12-28',
        periodStart: '2026-11-22',
        periodEnd: '2026-12-21',
        dueDay: 28,
        closingDaysBeforeDue: 7,
      },
    });
    expect(cardCycleRepository.sumCycleSpend).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      periodStart: '2026-11-22',
      periodEnd: '2026-12-21',
      timezone: card.timezone,
    });
  });

  it('falls back to the current cycle when no due date is given', async () => {
    cardCycleRepository.materializePeriod.mockResolvedValue(
      makePeriod({
        dueDate: '2026-11-28',
        periodStart: '2026-10-22',
        periodEnd: '2026-11-21',
      }),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
    });

    expect(result.isRight()).toBe(true);
    expect(cardCycleRepository.materializePeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        window: expect.objectContaining({ dueDate: '2026-11-28' }),
      }),
    );
  });

  it('returns null available when no limit is set, keeping the spend', async () => {
    cardCycleRepository.sumCycleSpend.mockResolvedValue(75_000);

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.limitCents).toBeNull();
    expect(result.value.cycleSpendCents).toBe(75_000);
    expect(result.value.availableCents).toBeNull();
  });

  it('allows available to go negative', async () => {
    cardCycleRepository.findApplicableBudget.mockResolvedValue(
      makeBudget(50_000),
    );
    cardCycleRepository.sumCycleSpend.mockResolvedValue(80_000);

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.availableCents).toBe(-30_000);
  });

  it('refuses a non card account before materializing anything', async () => {
    accountRepository.findById.mockResolvedValue(makeCheckingAccount());

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(AccountTypeError);
    expect(cardCycleRepository.materializePeriod).not.toHaveBeenCalled();
  });

  it('refuses a card without a due day before constructing the calendar', async () => {
    accountRepository.findById.mockResolvedValue(makeCardWithoutDueDay());

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(CardCycleNotConfiguredError);
    expect(cardCycleRepository.materializePeriod).not.toHaveBeenCalled();
  });

  it('serves the stored bounds and the saved limit of a frozen due date after the due day changes', async () => {
    const frozenPeriod = makePeriod({
      id: 'period-frozen',
      dueDate: '2026-11-28',
      periodStart: '2026-10-22',
      periodEnd: '2026-11-21',
      dueDay: 28,
    });
    const storedPeriods: CardCyclePeriodRecord[] = [frozenPeriod];
    const ledger: LedgerRow[] = [
      {
        accountId: 'acc-1',
        categoryId: 'cat-1',
        amount: 30_000,
        date: saoPauloNoonOf('2026-10-25'),
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
      },
      {
        accountId: 'acc-1',
        categoryId: 'cat-1',
        amount: 40_000,
        date: saoPauloNoonOf('2026-11-10'),
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
      },
      {
        accountId: 'acc-1',
        categoryId: 'cat-1',
        amount: 25_000,
        date: saoPauloNoonOf('2026-11-28'),
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
      },
    ];
    const cardCycleRepository = makeLedgerRepository(ledger, [
      makeBudget(200_000, { effectiveFrom: '2026-11-28' }),
    ]);
    cardCycleRepository.findPeriod = async (
      _workspaceId,
      _accountId,
      dueDate,
    ) => storedPeriods.find((period) => period.dueDate === dueDate) ?? null;
    cardCycleRepository.materializePeriod = jest.fn(
      async (input: MaterializeCardCyclePeriodInput) =>
        makePeriod({ id: 'period-new', ...input.window }),
    );
    const changedDueDay = makeStatusService(cardCycleRepository, dateProvider, {
      dueDay: 10,
    });

    const result = await changedDueDay.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      dueDate: '2026-11-28',
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value).toMatchObject({
      dueDate: '2026-11-28',
      periodStart: '2026-10-22',
      periodEnd: '2026-11-21',
      limitCents: 200_000,
      cycleSpendCents: 70_000,
      availableCents: 130_000,
    });
    expect(cardCycleRepository.materializePeriod).not.toHaveBeenCalled();
  });
});
