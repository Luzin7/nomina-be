import { AccountType, RecurrenceFrequency } from '@constants/enums';
import type { AnyAccount } from '@modules/account/entities/types';
import { CashAccount } from '@modules/account/entities/CashAccounts';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { InvestmentAccount } from '@modules/account/entities/InvestmentAccount';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import type { CardInvoiceWindow } from '@modules/account/valueObjects/CardInvoiceWindow';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import {
  CardCycleRepository,
  type CardCycleSpendInput,
} from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import {
  SpendableRecurrence,
  SpendableRepository,
} from '../../repositories/contracts/SpendableRepository';
import { SpendableWorkspaceNotFoundError } from '../../errors';
import type { SpendablePayload } from '../../presenters/Spendable.presenter';
import { GetSpendableService } from './get-spendable.handler';

const WORKSPACE_ID = 'ws-1';
const TIMEZONE = 'America/Sao_Paulo';
const NOW = new Date('2026-11-15T12:00:00.000Z');

type InvoiceOverride = {
  chargesBeforePeriod?: number;
  paymentsBeforePeriod?: number;
  paymentsInPeriod?: number;
  paymentsAfterClosing?: number;
};

type Given = {
  cycle: string | null;
  accounts: AnyAccount[];
  cashBalances?: { accountId: string; balanceCents: number }[];
  budgets: Record<string, number>;
  spends: Record<string, number>;
  invoices: Record<string, InvoiceOverride>;
  pendingCents: number;
  completedIncomeCents: number;
  recurrences: SpendableRecurrence[];
};

const checking = (balance: bigint, id = 'acc-1') =>
  makeCheckingAccount({ id, balance, timezone: TIMEZONE });

const investment = (balance: bigint, id = 'acc-9') => {
  const account = InvestmentAccount.create(
    { workspaceId: WORKSPACE_ID, name: 'Reserve', timezone: TIMEZONE, balance },
    id,
  );
  if (account.isLeft()) throw account.value;
  return account.value;
};

const isCashEntity = (
  account: AnyAccount,
): account is CheckingAccount | CashAccount =>
  account instanceof CheckingAccount || account instanceof CashAccount;

const cashRowsOf = (accounts: AnyAccount[]) =>
  accounts.filter(isCashEntity).map((account) => ({
    accountId: account.id,
    balanceCents: Number(account.balance),
  }));

const unreadableCard = (dueDay: number, id = 'card-bad'): CreditCard =>
  CreditCard.reconstitute(
    {
      workspaceId: WORKSPACE_ID,
      name: 'Broken',
      balance: 0n,
      creditLimit: 500000n,
      closingDaysBeforeDue: 5,
      dueDay,
      timezone: TIMEZONE,
      autoPayEnabled: false,
      autoPayConfirmedAt: null,
      autoPayEnabledAt: null,
      autoPaySourceAccountId: null,
    },
    id,
  );

const recurrence = (
  overrides: Partial<SpendableRecurrence> = {},
): SpendableRecurrence => ({
  id: 'rule-1',
  type: 'EXPENSE',
  accountType: AccountType.CHECKING,
  amount: 50000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDate: new Date('2026-11-05T12:00:00.000Z'),
  endDate: null,
  lastGenerated: null,
  materializedDates: [],
  ...overrides,
});

describe('GetSpendableService', () => {
  let given: Given;
  let now: Date;
  let dateProvider: DayJsDateProvider;
  let accountRepository: jest.Mocked<AccountRepository>;
  let cardCycleRepository: jest.Mocked<CardCycleRepository>;
  let cardInvoiceRepository: jest.Mocked<CardInvoiceRepository>;
  let spendableRepository: jest.Mocked<SpendableRepository>;
  let workspaceTimezone: { execute: jest.Mock };
  let cache: InMemoryCacheProvider;
  let service: GetSpendableService;

  const run = async (): Promise<SpendablePayload> => {
    const result = await service.execute({ workspaceId: WORKSPACE_ID });
    if (result.isLeft()) throw result.value;
    return result.value;
  };

  beforeEach(() => {
    given = {
      cycle: 'monthly',
      accounts: [],
      budgets: {},
      spends: {},
      invoices: {},
      pendingCents: 0,
      completedIncomeCents: 0,
      recurrences: [],
    };
    now = NOW;

    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockImplementation(() => now);

    accountRepository = {
      findAllByWorkspaceId: jest.fn(async () => given.accounts),
    } as unknown as jest.Mocked<AccountRepository>;

    cardCycleRepository = {
      findApplicableBudget: jest.fn(async (_workspaceId, accountId) => {
        const limitCents = given.budgets[accountId];
        if (limitCents === undefined) return null;
        return {
          id: `budget-${accountId}`,
          workspaceId: WORKSPACE_ID,
          accountId,
          effectiveFrom: '2026-01-01',
          limitCents,
        };
      }),
      sumCycleSpend: jest.fn(
        async ({ accountId, periodStart }: CardCycleSpendInput) =>
          given.spends[`${accountId}|${periodStart}`] ??
          given.spends[accountId] ??
          0,
      ),
    } as unknown as jest.Mocked<CardCycleRepository>;

    cardInvoiceRepository = {
      findTotals: jest.fn(async (_workspaceId, windows: CardInvoiceWindow[]) =>
        windows.map((window) => {
          const override =
            given.invoices[`${window.accountId}|${window.periodStart}`] ??
            given.invoices[window.accountId] ??
            {};
          const charges =
            given.spends[`${window.accountId}|${window.periodStart}`] ??
            given.spends[window.accountId] ??
            0;

          return {
            chargesBeforePeriod: BigInt(override.chargesBeforePeriod ?? 0),
            paymentsBeforePeriod: BigInt(override.paymentsBeforePeriod ?? 0),
            chargesInPeriod: BigInt(charges),
            paymentsInPeriod: BigInt(override.paymentsInPeriod ?? 0),
            paymentsAfterClosing: BigInt(override.paymentsAfterClosing ?? 0),
            pendingCharges: 0n,
          };
        }),
      ),
    } as unknown as jest.Mocked<CardInvoiceRepository>;

    spendableRepository = {
      findCycle: jest.fn(async () => given.cycle),
      readCashSnapshot: jest.fn(async () => ({
        cashBalances: given.cashBalances ?? cashRowsOf(given.accounts),
        pendingCents: given.pendingCents,
      })),
      sumCompletedCashIncome: jest.fn(async () => given.completedIncomeCents),
      listActiveRecurrences: jest.fn(async () => given.recurrences),
    } as unknown as jest.Mocked<SpendableRepository>;

    workspaceTimezone = { execute: jest.fn(async () => TIMEZONE) };
    cache = new InMemoryCacheProvider();

    service = new GetSpendableService(
      accountRepository,
      cardCycleRepository,
      cardInvoiceRepository,
      spendableRepository,
      workspaceTimezone as unknown as GetWorkspaceTimezoneService,
      dateProvider,
      cache,
    );
  });

  it('row 1: one account with income and nothing scheduled', async () => {
    given.accounts = [checking(500000n)];
    given.completedIncomeCents = 677000;
    given.recurrences = [recurrence({ type: 'INCOME', amount: 100000 })];

    const result = await run();

    expect(result.cashFreeCents).toBe(500000);
    expect(result.incomeCents).toBe(777000);
    expect(result.spendableCents).toBe(500000);
    expect(result.state).toBe('nothing_scheduled');
    expect(result.daysRemaining).toBe(16);
  });

  it('row 2: rent and an open invoice due inside the cycle are subtracted', async () => {
    given.accounts = [
      checking(500000n),
      makeCreditCard({ id: 'card-1', name: 'Visa', dueDay: 25 }),
    ];
    given.pendingCents = 100000;
    given.recurrences = [recurrence({ amount: 50000 })];
    given.spends['card-1'] = 80000;

    const result = await run();

    expect(result.obligationsCents).toBe(230000);
    expect(result.cashFreeCents).toBe(270000);
    expect(result.state).toBe('normal');
    expect(result.cards).toEqual([]);
  });

  it('row 3: a bill paid from a reserve is not subtracted', async () => {
    given.accounts = [checking(100000n)];
    given.completedIncomeCents = 300000;
    given.recurrences = [
      recurrence({ accountType: AccountType.INVESTMENT, amount: 40000 }),
    ];

    const result = await run();

    expect(result.obligationsCents).toBe(0);
    expect(result.spendableCents).toBe(100000);
    expect(result.state).toBe('nothing_scheduled');
  });

  it('row 4: one declared card adds its headroom and names the card', async () => {
    given.cycle = 'half_month';
    given.accounts = [
      checking(200000n),
      makeCreditCard({ id: 'card-1', name: 'Nubank', dueDay: 25 }),
    ];
    given.budgets['card-1'] = 50000;
    given.spends['card-1'] = 10000;

    const result = await run();

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      accountId: 'card-1',
      name: 'Nubank',
      limitCents: 50000,
      spendCents: 10000,
      headroomCents: 40000,
    });
    expect(result.cardsHeadroomCents).toBe(40000);
    expect(result.spendableCents).toBe(240000);
  });

  it('row 5: three declared cards sum their headrooms', async () => {
    given.cycle = 'half_month';
    given.accounts = [
      checking(200000n),
      makeCreditCard({ id: 'card-1', name: 'One', dueDay: 25 }),
      makeCreditCard({ id: 'card-2', name: 'Two', dueDay: 26 }),
      makeCreditCard({ id: 'card-3', name: 'Three', dueDay: 27 }),
    ];
    given.budgets = { 'card-1': 50000, 'card-2': 30000, 'card-3': 20000 };
    given.spends = { 'card-1': 10000, 'card-2': 10000, 'card-3': 5000 };

    const result = await run();

    expect(result.cards).toHaveLength(3);
    expect(result.cardsHeadroomCents).toBe(75000);
    expect(result.spendableCents).toBe(275000);
  });

  it('row 6: a card without a declared budget does not appear', async () => {
    given.cycle = 'half_month';
    given.accounts = [
      checking(200000n),
      makeCreditCard({ id: 'card-1', name: 'Visa', dueDay: 25 }),
    ];
    given.spends['card-1'] = 80000;

    const result = await run();

    expect(result.cards).toEqual([]);
    expect(result.obligationsCents).toBe(0);
    expect(result.spendableCents).toBe(200000);
  });

  it('row 7: a card budget with empty cash spends from the card only', async () => {
    given.cycle = 'half_month';
    given.accounts = [makeCreditCard({ id: 'card-1', dueDay: 25 })];
    given.budgets['card-1'] = 60000;
    given.spends['card-1'] = 10000;

    const result = await run();

    expect(result.cashFreeCents).toBe(0);
    expect(result.spendableCents).toBe(50000);
    expect(result.state).toBe('cards_only');
  });

  it('row 8: overdrawn cash stays negative and never nets the card', async () => {
    given.cycle = 'half_month';
    given.accounts = [
      checking(-51615n),
      makeCreditCard({ id: 'card-1', dueDay: 25 }),
    ];
    given.budgets['card-1'] = 50000;
    given.spends['card-1'] = 10000;

    const result = await run();

    expect(result.cashCents).toBe(-51615);
    expect(result.cashFreeCents).toBe(0);
    expect(result.spendableCents).toBe(40000);
    expect(result.state).toBe('negative_cash');
  });

  it('row 9: obligations larger than cash zero the cash pool', async () => {
    given.accounts = [checking(100000n)];
    given.pendingCents = 150000;

    const result = await run();

    expect(result.cashFreeCents).toBe(0);
    expect(result.spendableCents).toBe(0);
    expect(result.state).toBe('obligations_above_cash');
  });

  it('row 10: a half-month cycle closes on the fifteenth', async () => {
    given.cycle = 'half_month';
    given.accounts = [checking(300000n)];

    const result = await run();

    expect(result.cycleStartDate).toBe('2026-11-01');
    expect(result.cycleEndDate).toBe('2026-11-15');
    expect(result.daysRemaining).toBe(1);
    expect(result.spendableCents).toBe(300000);
    expect(spendableRepository.readCashSnapshot).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      startDate: '2026-11-01',
      endDate: '2026-11-15',
      timezone: TIMEZONE,
    });
  });

  it('row 11: a bare balance without income reads as the account balance', async () => {
    given.accounts = [checking(100000n)];

    const result = await run();

    expect(result.incomeCents).toBe(0);
    expect(result.spendableCents).toBe(100000);
    expect(result.state).toBe('balance_only');
  });

  it('row 12: an empty workspace reads zero', async () => {
    const result = await run();

    expect(result.spendableCents).toBe(0);
    expect(result.cashCents).toBe(0);
    expect(result.state).toBe('zero');
  });

  it('row 13: a reserve that cannot cover its own bills leaves the hero unchanged', async () => {
    given.accounts = [checking(200000n), investment(10000n)];
    given.recurrences = [
      recurrence({ accountType: AccountType.INVESTMENT, amount: 500000 }),
    ];

    const result = await run();

    expect(result.cashCents).toBe(200000);
    expect(result.obligationsCents).toBe(0);
    expect(result.spendableCents).toBe(200000);
  });

  it('edge: an invoice due today counts', async () => {
    given.accounts = [makeCreditCard({ id: 'card-1', dueDay: 15 })];
    given.spends['card-1|2026-10-11'] = 80000;

    const result = await run();

    expect(result.obligationsCents).toBe(80000);
  });

  it('edge: a recurring bill already paid in the cycle does not count', async () => {
    const startDate = new Date('2026-11-05T12:00:00.000Z');
    given.accounts = [checking(100000n)];
    given.completedIncomeCents = 200000;
    given.recurrences = [
      recurrence({ startDate, materializedDates: [startDate] }),
    ];

    const result = await run();

    expect(result.obligationsCents).toBe(0);
    expect(result.spendableCents).toBe(100000);
  });

  it('edge: a recurrence sourced from a card is never counted directly', async () => {
    given.accounts = [checking(100000n)];
    given.completedIncomeCents = 200000;
    given.recurrences = [
      recurrence({
        accountType: AccountType.CREDIT_CARD,
        amount: 90000,
        startDate: new Date('2026-11-10T12:00:00.000Z'),
      }),
    ];

    const result = await run();

    expect(result.obligationsCents).toBe(0);
    expect(result.spendableCents).toBe(100000);
  });

  it('edge: a card installment is counted once through the invoice', async () => {
    given.cycle = 'half_month';
    given.accounts = [
      checking(100000n),
      makeCreditCard({ id: 'card-1', dueDay: 25 }),
    ];
    given.budgets['card-1'] = 150000;
    given.spends['card-1'] = 100000;

    const result = await run();

    expect(cardCycleRepository.sumCycleSpend).toHaveBeenCalledTimes(1);
    expect(cardCycleRepository.sumCycleSpend).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'card-1',
        periodStart: '2026-10-21',
        periodEnd: '2026-11-20',
      }),
    );
    expect(result.obligationsCents).toBe(0);
    expect(result.spendableCents).toBe(150000);
  });

  it('edge: the budget of the current invoice cycle is the one applied', async () => {
    given.cycle = 'half_month';
    given.accounts = [
      checking(100000n),
      makeCreditCard({ id: 'card-1', dueDay: 25 }),
    ];
    given.budgets['card-1'] = 50000;

    await run();

    expect(cardCycleRepository.findApplicableBudget).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'card-1',
      '2026-11-25',
    );
  });

  it('edge: an invoice paid through the app is not subtracted again', async () => {
    given.accounts = [
      checking(0n),
      makeCreditCard({ id: 'card-1', dueDay: 25 }),
    ];
    given.spends['card-1'] = 100000;
    given.invoices['card-1'] = { paymentsInPeriod: 100000 };

    const result = await run();

    expect(result.obligationsCents).toBe(0);
    expect(result.spendableCents).toBe(0);
  });

  it('edge: an invoice settled by auto-pay is not subtracted again', async () => {
    given.accounts = [
      checking(0n),
      makeCreditCard({ id: 'card-1', dueDay: 25 }),
    ];
    given.spends['card-1'] = 100000;
    given.invoices['card-1'] = { paymentsAfterClosing: 100000 };

    const result = await run();

    expect(result.obligationsCents).toBe(0);
  });

  it('edge: the invoice obligation carries the previous balance', async () => {
    given.accounts = [
      checking(200000n),
      makeCreditCard({ id: 'card-1', dueDay: 25 }),
    ];
    given.spends['card-1'] = 20000;
    given.invoices['card-1'] = { chargesBeforePeriod: 30000 };

    const result = await run();

    expect(result.obligationsCents).toBe(50000);
    expect(result.cashFreeCents).toBe(150000);
  });

  it('edge: a bill paid by autopay from a reserve is not subtracted', async () => {
    given.accounts = [
      checking(200000n),
      investment(100000n),
      makeCreditCard({
        id: 'card-1',
        dueDay: 25,
        autoPayEnabled: true,
        autoPaySourceAccountId: 'acc-9',
        autoPayEnabledAt: NOW,
      }),
    ];
    given.spends['card-1'] = 100000;

    const result = await run();

    expect(result.obligationsCents).toBe(0);
    expect(result.spendableCents).toBe(200000);
  });

  it('edge: a bill paid by autopay from cash is still subtracted', async () => {
    given.accounts = [
      checking(200000n),
      makeCreditCard({
        id: 'card-1',
        dueDay: 25,
        autoPayEnabled: true,
        autoPaySourceAccountId: 'acc-1',
        autoPayEnabledAt: NOW,
      }),
    ];
    given.spends['card-1'] = 100000;

    const result = await run();

    expect(result.obligationsCents).toBe(100000);
  });

  it('edge: every card invoice is read in a single call', async () => {
    given.accounts = [
      checking(200000n),
      makeCreditCard({ id: 'card-1', name: 'One', dueDay: 20 }),
      makeCreditCard({ id: 'card-2', name: 'Two', dueDay: 25 }),
    ];

    await run();

    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledTimes(1);
    expect(cardInvoiceRepository.findTotals.mock.calls[0][1]).toHaveLength(2);
  });

  it('edge: an out-of-range due day lists the card instead of failing', async () => {
    given.accounts = [checking(200000n), unreadableCard(32)];

    const result = await run();

    expect(result.cardsWithoutDueDate).toEqual([
      { accountId: 'card-bad', name: 'Broken', limitCents: 500000 },
    ]);
    expect(result.cashFreeCents).toBe(200000);
  });

  it('edge: cash reads the same account types as the pending bills', async () => {
    given.accounts = [checking(100000n)];
    given.cashBalances = [{ accountId: 'acc-1', balanceCents: 30000 }];

    const result = await run();

    expect(result.cashCents).toBe(30000);
    expect(result.cashFreeCents).toBe(30000);
  });

  it('edge: a card with no due date is listed instead of dropped', async () => {
    given.accounts = [
      checking(200000n),
      makeCreditCard({
        id: 'card-1',
        name: 'Visa',
        dueDay: null,
        creditLimit: 500000n,
      }),
    ];

    const result = await run();

    expect(result.cards).toEqual([]);
    expect(result.cardsWithoutDueDate).toEqual([
      { accountId: 'card-1', name: 'Visa', limitCents: 500000 },
    ]);
    expect(result.spendableCents).toBe(200000);
  });

  it('edge: a card with no due date is never counted', async () => {
    given.accounts = [
      checking(200000n),
      makeCreditCard({ id: 'card-1', dueDay: null }),
    ];
    given.budgets['card-1'] = 50000;

    const result = await run();

    expect(cardCycleRepository.sumCycleSpend).not.toHaveBeenCalled();
    expect(cardInvoiceRepository.findTotals).not.toHaveBeenCalled();
    expect(result.cards).toEqual([]);
    expect(result.spendableCents).toBe(200000);
  });

  it('edge: the month boundary is read in the workspace timezone', async () => {
    given.accounts = [checking(100000n)];

    now = new Date('2026-12-01T02:59:00.000Z');
    const before = await run();
    expect(before.cycleStartDate).toBe('2026-11-01');
    expect(before.cycleEndDate).toBe('2026-11-30');

    now = new Date('2026-12-01T03:01:00.000Z');
    const after = await run();
    expect(after.cycleStartDate).toBe('2026-12-01');
    expect(after.cycleEndDate).toBe('2026-12-31');
  });

  it('edge: a pending payment already materialized is not counted twice', async () => {
    const startDate = new Date('2026-11-05T12:00:00.000Z');
    given.accounts = [checking(100000n)];
    given.completedIncomeCents = 200000;
    given.pendingCents = 50000;
    given.recurrences = [
      recurrence({ startDate, materializedDates: [startDate] }),
    ];

    const result = await run();

    expect(result.obligationsCents).toBe(50000);
    expect(result.spendableCents).toBe(50000);
  });

  it('edge: the numbers are for the workspace, never per member', async () => {
    given.accounts = [checking(100000n)];
    given.pendingCents = 20000;

    await run();

    expect(spendableRepository.readCashSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );
    expect(spendableRepository.listActiveRecurrences).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
  });

  it('fails when the workspace does not exist', async () => {
    given.cycle = null;

    const result = await service.execute({ workspaceId: WORKSPACE_ID });

    if (!result.isLeft()) throw new Error('expected a left result');
    expect(result.value).toBeInstanceOf(SpendableWorkspaceNotFoundError);
  });

  it('falls back to the monthly cycle when the stored value is unknown', async () => {
    given.cycle = 'yearly';
    given.accounts = [checking(100000n)];

    const result = await run();

    expect(result.cycle).toBe('monthly');
    expect(result.cycleStartDate).toBe('2026-11-01');
    expect(result.cycleEndDate).toBe('2026-11-30');
  });

  it('returns the reviewed payload with every field named', async () => {
    given.accounts = [
      checking(200000n),
      makeCreditCard({ id: 'card-1', name: 'Nubank', dueDay: 25 }),
    ];
    given.budgets['card-1'] = 50000;
    given.spends['card-1'] = 10000;
    given.pendingCents = 50000;
    given.completedIncomeCents = 677000;

    const result = await run();

    expect(result).toEqual({
      state: 'normal',
      cycle: 'monthly',
      cycleStartDate: '2026-11-01',
      cycleEndDate: '2026-11-30',
      daysRemaining: 16,
      cashCents: 200000,
      obligationsCents: 60000,
      cashFreeCents: 140000,
      incomeCents: 677000,
      cards: [
        {
          accountId: 'card-1',
          name: 'Nubank',
          dueDate: '2026-11-25',
          limitCents: 50000,
          spendCents: 10000,
          headroomCents: 40000,
        },
      ],
      cardsWithoutDueDate: [],
      cardsHeadroomCents: 40000,
      spendableCents: 180000,
    });
  });

  it('serves the second read from the cache', async () => {
    given.accounts = [checking(100000n)];

    await run();
    await run();

    expect(accountRepository.findAllByWorkspaceId).toHaveBeenCalledTimes(1);
  });

  it('keeps the cycle in the cache key', async () => {
    given.accounts = [checking(100000n)];

    const monthly = await run();
    given.cycle = 'half_month';
    const halfMonth = await run();

    expect(monthly.cycleEndDate).toBe('2026-11-30');
    expect(halfMonth.cycleEndDate).toBe('2026-11-15');
    expect(accountRepository.findAllByWorkspaceId).toHaveBeenCalledTimes(2);
  });
});
