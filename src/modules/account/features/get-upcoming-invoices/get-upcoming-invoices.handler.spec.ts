import { RecurrenceFrequency } from '@constants/enums';
import {
  AccountNotFoundError,
  AccountTypeError,
  CreditCardCycleNotConfiguredError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import {
  CardRecurrence,
  CardRecurrenceRepository,
} from '@modules/account/repositories/contracts/CardRecurrenceRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { CardInvoiceTotals } from '@modules/account/valueObjects/CardInvoiceWindow';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { GetWorkspaceCycleService } from '@modules/workspace/services/get-workspace-cycle.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { ledgerGenerationKey } from '@shared/cache/report-cache';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { GetUpcomingInvoicesService } from './get-upcoming-invoices.handler';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const TOTALS_ROWS = 7;

const makeTotals = (
  overrides: Partial<CardInvoiceTotals> = {},
): CardInvoiceTotals => ({
  chargesBeforePeriod: 0n,
  paymentsBeforePeriod: 0n,
  chargesInPeriod: 0n,
  paymentsInPeriod: 0n,
  paymentsAfterClosing: 0n,
  pendingCharges: 0n,
  ...overrides,
});

const makeRecurrence = (
  overrides: Partial<CardRecurrence> = {},
): CardRecurrence => ({
  id: 'rule-1',
  categoryId: null,
  amount: 5000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDate: new Date('2026-12-20T15:00:00.000Z'),
  endDate: null,
  lastGenerated: null,
  materializedDates: [],
  ...overrides,
});

const invoiceTotals = (overrides: Record<number, bigint> = {}) =>
  Array.from({ length: TOTALS_ROWS }, (_, index) =>
    makeTotals({ pendingCharges: overrides[index] ?? 0n }),
  );

describe('GetUpcomingInvoicesService', () => {
  let service: GetUpcomingInvoicesService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let cardInvoiceRepository: jest.Mocked<CardInvoiceRepository>;
  let cardRecurrenceRepository: jest.Mocked<CardRecurrenceRepository>;
  let workspaceCycle: jest.Mocked<GetWorkspaceCycleService>;
  let dateProvider: DayJsDateProvider;
  let cache: InMemoryCacheProvider;

  const build = (now: Date = NOW) => {
    jest.spyOn(dateProvider, 'now').mockReturnValue(now);
    service = new GetUpcomingInvoicesService(
      accountRepository,
      cardInvoiceRepository,
      cardRecurrenceRepository,
      workspaceCycle,
      {
        execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
      } as unknown as GetWorkspaceTimezoneService,
      dateProvider,
      cache,
    );
  };

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<AccountRepository>;
    cardInvoiceRepository = {
      findTotals: jest.fn().mockResolvedValue(invoiceTotals()),
      findPeriodTransactions: jest.fn(),
    } as jest.Mocked<CardInvoiceRepository>;
    cardRecurrenceRepository = {
      findCardRecurrences: jest.fn().mockResolvedValue([]),
    } as jest.Mocked<CardRecurrenceRepository>;
    workspaceCycle = {
      execute: jest.fn().mockResolvedValue('monthly'),
    } as unknown as jest.Mocked<GetWorkspaceCycleService>;
    dateProvider = new DayJsDateProvider();
    cache = new InMemoryCacheProvider();
    build();
  });

  const run = (accountId = 'acc-1', workspaceId = 'ws-1') =>
    service.execute({ accountId, workspaceId, sub: 'user-1' });

  it('returns AccountNotFoundError when the account does not exist', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await run();

    expect(result.value).toBeInstanceOf(AccountNotFoundError);
  });

  it('returns WorkspaceNotFoundError when the workspace is gone', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    workspaceCycle.execute.mockResolvedValue(null);

    const result = await run();

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('returns UnauthorizedError for an account of another workspace', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ workspaceId: 'ws-2' }),
    );

    const result = await run();

    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('returns AccountTypeError for a non-card account', async () => {
    accountRepository.findById.mockResolvedValue(makeCheckingAccount());

    const result = await run();

    expect(result.value).toBeInstanceOf(AccountTypeError);
  });

  it('returns CreditCardCycleNotConfiguredError without a due day', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ dueDay: null }),
    );

    const result = await run();

    expect(result.value).toBeInstanceOf(CreditCardCycleNotConfiguredError);
  });

  it('lists the six invoices starting at the open one with their bounds', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());

    const result = await run();

    expect(result.isRight()).toBe(true);
    expect(result.value).toMatchObject({
      invoices: [
        {
          key: '2026-11',
          periodStart: '2026-10-11',
          periodEnd: '2026-11-10',
          dueDate: '2026-11-15',
        },
        { key: '2026-12' },
        { key: '2027-01' },
        { key: '2027-02' },
        { key: '2027-03' },
        { key: '2027-04', periodEnd: '2027-04-10', dueDate: '2027-04-15' },
      ],
    });
  });

  it('counts a materialized pending row on the occurrence date once', async () => {
    const occurrence = new Date('2026-12-20T15:00:00.000Z');
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    cardInvoiceRepository.findTotals.mockResolvedValue(
      invoiceTotals({ 3: 5000n }),
    );
    cardRecurrenceRepository.findCardRecurrences.mockResolvedValue([
      makeRecurrence({ materializedDates: [occurrence] }),
    ]);

    const result = await run();

    expect(result.value).toMatchObject({
      invoices: [
        { key: '2026-11', projectedCents: 0, committedCents: 0 },
        { key: '2026-12', projectedCents: 0 },
        {
          key: '2027-01',
          pendingChargesCents: 5000,
          projectedCents: 0,
          committedCents: 5000,
        },
        {
          key: '2027-02',
          pendingChargesCents: 0,
          projectedCents: 5000,
          committedCents: 5000,
        },
        { key: '2027-03', projectedCents: 5000 },
        { key: '2027-04', projectedCents: 5000 },
      ],
    });
  });

  it('stops an installment that ends inside the window', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    cardRecurrenceRepository.findCardRecurrences.mockResolvedValue([
      makeRecurrence({ endDate: new Date('2027-02-25T15:00:00.000Z') }),
    ]);

    const result = await run();

    expect(result.value).toMatchObject({
      invoices: [
        { key: '2026-11', projectedCents: 0 },
        { key: '2026-12', projectedCents: 0 },
        { key: '2027-01', projectedCents: 5000 },
        { key: '2027-02', projectedCents: 5000 },
        { key: '2027-03', projectedCents: 5000 },
        { key: '2027-04', projectedCents: 0 },
      ],
    });
  });

  it('asks the repository for rules of the account inside the window', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());

    await run();

    expect(cardRecurrenceRepository.findCardRecurrences).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      from: new Date('2026-10-11T03:00:00.000Z'),
      to: new Date('2027-04-11T03:00:00.000Z'),
    });
  });

  it('reads one totals row per invoice', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());

    await run();

    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledWith('ws-1', [
      expect.objectContaining({ periodStart: '2026-09-11' }),
      expect.objectContaining({ periodStart: '2026-10-11' }),
      expect.objectContaining({ periodStart: '2026-11-11' }),
      expect.objectContaining({ periodStart: '2026-12-11' }),
      expect.objectContaining({ periodStart: '2027-01-11' }),
      expect.objectContaining({ periodStart: '2027-02-11' }),
      expect.objectContaining({ periodStart: '2027-03-11' }),
    ]);
  });

  it('keeps the maximum due day 28 on the February invoice', async () => {
    build(new Date('2027-01-05T12:00:00.000Z'));
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ dueDay: 28 }),
    );

    const result = await run();

    expect(result.value).toMatchObject({
      invoices: [
        {
          key: '2027-01',
          periodStart: '2026-12-24',
          periodEnd: '2027-01-23',
          dueDate: '2027-01-28',
        },
        { key: '2027-02', periodStart: '2027-01-24', dueDate: '2027-02-28' },
        { key: '2027-03' },
        { key: '2027-04' },
        { key: '2027-05' },
        { key: '2027-06' },
      ],
    });
  });

  it('does not serve one card the cached entry of another card', async () => {
    accountRepository.findById.mockImplementation(async (id) =>
      makeCreditCard({ id }),
    );
    cardInvoiceRepository.findTotals
      .mockResolvedValueOnce(invoiceTotals({ 1: 100n }))
      .mockResolvedValueOnce(invoiceTotals({ 1: 700n }));

    await run('acc-1');
    const second = await run('acc-2');

    expect(second.value).toMatchObject({
      invoices: [{ pendingChargesCents: 700 }, {}, {}, {}, {}, {}],
    });
  });

  it('serves the cached response until the ledger generation changes', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    cardInvoiceRepository.findTotals
      .mockResolvedValueOnce(invoiceTotals({ 1: 100n }))
      .mockResolvedValueOnce(invoiceTotals({ 1: 900n }));

    await run();
    const cached = await run();
    await cache.incrementCounter(ledgerGenerationKey('ws-1'), 0);
    const recomputed = await run();

    expect(cached.value).toMatchObject({
      invoices: [{ pendingChargesCents: 100 }, {}, {}, {}, {}, {}],
    });
    expect(recomputed.value).toMatchObject({
      invoices: [{ pendingChargesCents: 900 }, {}, {}, {}, {}, {}],
    });
  });

  it('resolves today in the workspace timezone', async () => {
    build(new Date('2026-10-11T02:00:00.000Z'));
    accountRepository.findById.mockResolvedValue(makeCreditCard());

    const result = await run();

    expect(result.value).toMatchObject({
      invoices: [{ key: '2026-10' }, {}, {}, {}, {}, {}],
    });
  });
});
