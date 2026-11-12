import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { GetCreditCardInvoiceService } from '@modules/account/features/get-credit-card-invoice/get-credit-card-invoice.handler';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { PayCreditCardInvoiceService } from '@modules/transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.service';
import {
  AutopayCandidate,
  CardInvoiceSettlementRepository,
} from '@modules/transaction/repositories/contracts/CardInvoiceSettlementRepository';
import { makeTransaction } from '@modules/transaction/test-helpers/mock-factories';
import { Logger } from '@nestjs/common';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { captureException } from '@sentry/nestjs';
import { left, right } from '@shared/core/errors/Either';
import { AutoPayCardInvoicesJobService } from './auto-pay-card-invoices.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const loggerWarn = jest
  .spyOn(Logger.prototype, 'warn')
  .mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

const MINUTE_MS = 60_000;
const NOW = new Date('2024-03-15T15:00:00.000Z');
const TOTAL = 25_000n;
const SOURCE_ID = 'source-1';
const LOCK = { key: 'job:auto-pay-card-invoices', token: 'token' };

const makeCandidate = (
  overrides: Partial<AutopayCandidate> = {},
): AutopayCandidate => ({
  cardAccountId: 'card-1',
  workspaceId: 'ws-1',
  timezone: 'UTC',
  dueDay: 15,
  closingDaysBeforeDue: 5,
  sourceAccountId: SOURCE_ID,
  autoPayEnabledAt: new Date('2024-03-01T00:00:00.000Z'),
  ...overrides,
});

const invoiceOf = (overrides: Record<string, unknown> = {}) => ({
  invoiceStatus: 'closed',
  totalAmount: TOTAL,
  ...overrides,
});

describe('AutoPayCardInvoicesJobService', () => {
  let service: AutoPayCardInvoicesJobService;
  let settlements: jest.Mocked<CardInvoiceSettlementRepository>;
  let accounts: jest.Mocked<AccountRepository>;
  let getInvoice: jest.Mocked<GetCreditCardInvoiceService>;
  let payInvoice: jest.Mocked<PayCreditCardInvoiceService>;
  let cache: jest.Mocked<CacheProvider>;
  let dateProvider: DayJsDateProvider;

  const runWith = (
    candidates: AutopayCandidate[],
    targetKey = '2024-03',
    target = invoiceOf(),
  ) => {
    settlements.findAutopayCandidates.mockResolvedValueOnce(candidates);
    settlements.countAutopayCandidates.mockResolvedValue(candidates.length);
    getInvoice.execute.mockImplementation(async ({ month, year }) => {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      return right(
        (key === targetKey
          ? target
          : invoiceOf({ invoiceStatus: 'paid' })) as never,
      );
    });
    return service.execute();
  };

  beforeEach(() => {
    settlements = {
      findAutopayCandidates: jest.fn().mockResolvedValue([]),
      countAutopayCandidates: jest.fn().mockResolvedValue(0),
      isAutopayActive: jest.fn().mockResolvedValue(true),
      claim: jest.fn().mockResolvedValue('claim-1'),
      findClaim: jest.fn(),
      releaseClaim: jest.fn().mockResolvedValue(undefined),
      attachTransaction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CardInvoiceSettlementRepository>;
    accounts = {
      findById: jest.fn().mockResolvedValue(
        makeCheckingAccount({
          id: SOURCE_ID,
          workspaceId: 'ws-1',
          balance: 1_000_000n,
        }),
      ),
    } as unknown as jest.Mocked<AccountRepository>;
    getInvoice = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetCreditCardInvoiceService>;
    payInvoice = {
      execute: jest
        .fn()
        .mockResolvedValue(right(makeTransaction({ id: 'tx-1' }))),
    } as unknown as jest.Mocked<PayCreditCardInvoiceService>;
    cache = {
      acquireLock: jest.fn().mockResolvedValue(LOCK),
      releaseLock: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CacheProvider>;
    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new AutoPayCardInvoicesJobService(
      settlements,
      accounts,
      getInvoice,
      payInvoice,
      cache,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should pay the exact invoice total from the configured source and attach the transaction', async () => {
    const summary = await runWith([makeCandidate()]);

    expect(payInvoice.execute).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      sub: 'system:auto-pay-card-invoices',
      creditCardAccountId: 'card-1',
      sourceAccountId: SOURCE_ID,
      amount: Number(TOTAL),
      month: 3,
      year: 2024,
      categoryId: undefined,
    });
    expect(settlements.attachTransaction).toHaveBeenCalledWith(
      'claim-1',
      'tx-1',
    );
    expect(summary.outcome).toBe('success');
    expect(summary.settledCount).toBe(1);
  });

  it('should return nothing-due without touching candidates when the lock is held elsewhere', async () => {
    cache.acquireLock.mockResolvedValue(null);

    const summary = await service.execute();

    expect(summary.outcome).toBe('nothing-due');
    expect(summary.lockBusy).toBe(true);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('lock busy'),
    );
    expect(settlements.findAutopayCandidates).not.toHaveBeenCalled();
  });

  it('should not flag lockBusy when the lock is acquired', async () => {
    const summary = await runWith([]);

    expect(summary.lockBusy).toBe(false);
  });

  it('should skip as disabled without claiming when autopay was turned off after the batch was read', async () => {
    settlements.isAutopayActive.mockResolvedValue(false);

    const summary = await runWith([makeCandidate()]);

    expect(settlements.isAutopayActive).toHaveBeenCalledWith(
      'card-1',
      SOURCE_ID,
    );
    expect(summary.skipped.disabled).toBe(1);
    expect(settlements.claim).not.toHaveBeenCalled();
    expect(payInvoice.execute).not.toHaveBeenCalled();
  });

  it('should release the lock after a run', async () => {
    await runWith([]);

    expect(cache.acquireLock).toHaveBeenCalledWith(
      'job:auto-pay-card-invoices',
      300,
    );
    expect(cache.releaseLock).toHaveBeenCalledWith(LOCK);
  });

  it('should report nothing-due when no card is enabled', async () => {
    const summary = await runWith([]);

    expect(summary).toMatchObject({
      outcome: 'nothing-due',
      processedCount: 0,
    });
  });

  describe('skip reasons', () => {
    it('should skip an already paid invoice without claiming', async () => {
      const summary = await runWith(
        [makeCandidate()],
        '2024-03',
        invoiceOf({ invoiceStatus: 'paid' }),
      );

      expect(summary.skipped['already-paid']).toBe(1);
      expect(settlements.claim).not.toHaveBeenCalled();
      expect(payInvoice.execute).not.toHaveBeenCalled();
    });

    it('should skip an invoice with nothing to pay without claiming', async () => {
      const summary = await runWith(
        [makeCandidate()],
        '2024-03',
        invoiceOf({ totalAmount: 0n }),
      );

      expect(summary.skipped['nothing-to-pay']).toBe(1);
      expect(settlements.claim).not.toHaveBeenCalled();
    });

    it('should skip as already-settled when the existing claim has a transaction', async () => {
      settlements.claim.mockResolvedValue(null);
      settlements.findClaim.mockResolvedValue({
        id: 'claim-0',
        transactionId: 'tx-0',
        createdAt: NOW,
      });

      const summary = await runWith([makeCandidate()]);

      expect(summary.skipped['already-settled']).toBe(1);
      expect(payInvoice.execute).not.toHaveBeenCalled();
    });

    it('should skip as settled-by-another-run when the claim is fresh and unpaid', async () => {
      settlements.claim.mockResolvedValue(null);
      settlements.findClaim.mockResolvedValue({
        id: 'claim-0',
        transactionId: null,
        createdAt: new Date(NOW.getTime() - 5 * MINUTE_MS),
      });

      const summary = await runWith([makeCandidate()]);

      expect(summary.skipped['settled-by-another-run']).toBe(1);
      expect(settlements.releaseClaim).not.toHaveBeenCalled();
      expect(payInvoice.execute).not.toHaveBeenCalled();
    });
  });

  describe('claim ttl', () => {
    const staleClaimAged = (ms: number) => {
      settlements.claim
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('claim-2');
      settlements.findClaim.mockResolvedValue({
        id: 'claim-0',
        transactionId: null,
        createdAt: new Date(NOW.getTime() - ms),
      });
    };

    it('should reclaim a claim older than 30 minutes and pay once', async () => {
      staleClaimAged(30 * MINUTE_MS + 1_000);

      const summary = await runWith([makeCandidate()]);

      expect(settlements.releaseClaim).toHaveBeenCalledWith('claim-0');
      expect(settlements.claim).toHaveBeenCalledTimes(2);
      expect(payInvoice.execute).toHaveBeenCalledTimes(1);
      expect(summary.settledCount).toBe(1);
    });

    it('should not reclaim a claim younger than 30 minutes', async () => {
      settlements.claim.mockResolvedValue(null);
      settlements.findClaim.mockResolvedValue({
        id: 'claim-0',
        transactionId: null,
        createdAt: new Date(NOW.getTime() - 29 * MINUTE_MS - 59_000),
      });

      const summary = await runWith([makeCandidate()]);

      expect(settlements.releaseClaim).not.toHaveBeenCalled();
      expect(summary.skipped['settled-by-another-run']).toBe(1);
    });

    it('should reclaim only once when the retried claim is lost again', async () => {
      settlements.claim.mockResolvedValue(null);
      settlements.findClaim.mockResolvedValue({
        id: 'claim-0',
        transactionId: null,
        createdAt: new Date(NOW.getTime() - 60 * MINUTE_MS),
      });

      const summary = await runWith([makeCandidate()]);

      expect(settlements.claim).toHaveBeenCalledTimes(2);
      expect(summary.skipped['settled-by-another-run']).toBe(1);
      expect(payInvoice.execute).not.toHaveBeenCalled();
    });
  });

  describe('insufficient balance', () => {
    beforeEach(() => {
      accounts.findById.mockResolvedValue(
        makeCheckingAccount({
          id: SOURCE_ID,
          workspaceId: 'ws-1',
          balance: TOTAL - 1n,
        }),
      );
    });

    it('should release the claim, skip and never pay', async () => {
      const summary = await runWith([makeCandidate()]);

      expect(settlements.releaseClaim).toHaveBeenCalledWith('claim-1');
      expect(payInvoice.execute).not.toHaveBeenCalled();
      expect(summary.skipped['insufficient-balance']).toBe(1);
      expect(summary.failedCount).toBe(0);
    });

    it('should warn naming workspace, card, period, needed and available', async () => {
      await runWith([makeCandidate()]);

      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining(
          `workspace=ws-1 card=card-1 period=2024-03 needed=${TOTAL} available=${TOTAL - 1n}`,
        ),
      );
    });
  });

  describe('failures', () => {
    it('should release the claim and count a failure when the payment is rejected', async () => {
      payInvoice.execute.mockResolvedValue(left(new Error('boom')));

      const summary = await runWith([makeCandidate()]);

      expect(settlements.releaseClaim).toHaveBeenCalledWith('claim-1');
      expect(settlements.attachTransaction).not.toHaveBeenCalled();
      expect(summary).toMatchObject({
        outcome: 'total-failure',
        failedCount: 1,
        settledCount: 0,
      });
      expect(captureException).toHaveBeenCalled();
    });

    it('should keep the claim when the payment succeeded but the attach failed', async () => {
      settlements.attachTransaction.mockRejectedValue(new Error('db down'));

      const summary = await runWith([makeCandidate()]);

      expect(settlements.releaseClaim).not.toHaveBeenCalled();
      expect(summary.failedCount).toBe(1);
    });

    it('should continue with the next card after one throws', async () => {
      settlements.findAutopayCandidates.mockResolvedValueOnce([
        makeCandidate({ cardAccountId: 'card-bad', dueDay: 99 }),
        makeCandidate({ cardAccountId: 'card-ok' }),
      ]);
      settlements.countAutopayCandidates.mockResolvedValue(2);
      getInvoice.execute.mockImplementation(async ({ month, year }) =>
        right(
          (month === 3 && year === 2024
            ? invoiceOf()
            : invoiceOf({ invoiceStatus: 'paid' })) as never,
        ),
      );

      const summary = await service.execute();

      expect(summary).toMatchObject({
        outcome: 'partial-failure',
        settledCount: 1,
        failedCount: 1,
      });
    });
  });

  describe('time budget', () => {
    it('should stop starting cards and report the remaining ones', async () => {
      jest
        .spyOn(dateProvider, 'now')
        .mockReturnValueOnce(NOW)
        .mockReturnValue(new Date(NOW.getTime() + 30_000));
      settlements.findAutopayCandidates.mockResolvedValueOnce([
        makeCandidate({ cardAccountId: 'card-1' }),
        makeCandidate({ cardAccountId: 'card-2' }),
      ]);
      settlements.countAutopayCandidates.mockResolvedValue(2);
      getInvoice.execute.mockResolvedValue(
        right(invoiceOf({ invoiceStatus: 'paid' }) as never),
      );

      const summary = await service.execute();

      expect(summary.remainingCount).toBe(1);
      expect(getInvoice.execute).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'card-1' }),
      );
      expect(getInvoice.execute).not.toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'card-2' }),
      );
    });
  });

  describe('due date in the card timezone', () => {
    const SAO_PAULO = 'America/Sao_Paulo';

    it.each([
      ['America/Sao_Paulo', '2024-03-15T23:30:00-03:00', true],
      ['America/Sao_Paulo', '2024-03-14T23:30:00-03:00', false],
      ['UTC', '2024-03-15T23:30:00Z', true],
      ['UTC', '2024-03-14T23:30:00Z', false],
      ['UTC', '2024-03-15T02:30:00Z', true],
      [SAO_PAULO, '2024-03-15T02:30:00Z', false],
    ])('card in %s at %s pays: %s', async (timezone, instant, pays) => {
      jest.spyOn(dateProvider, 'now').mockReturnValue(new Date(instant));

      await runWith([makeCandidate({ timezone })]);

      expect(payInvoice.execute).toHaveBeenCalledTimes(pays ? 1 : 0);
    });

    it('should never settle a future invoice', async () => {
      await runWith([makeCandidate()], '2024-04');

      expect(payInvoice.execute).not.toHaveBeenCalled();
    });
  });

  describe('activation cutoff', () => {
    const runAllUnpaid = (candidate: AutopayCandidate) => {
      settlements.findAutopayCandidates.mockResolvedValueOnce([candidate]);
      settlements.countAutopayCandidates.mockResolvedValue(1);
      getInvoice.execute.mockResolvedValue(right(invoiceOf() as never));
      return service.execute();
    };

    const paidMonths = () =>
      payInvoice.execute.mock.calls.map(([{ month, year }]) => [year, month]);

    it('should skip an invoice due before the activation date', async () => {
      await runAllUnpaid(
        makeCandidate({
          autoPayEnabledAt: new Date('2024-03-16T10:00:00.000Z'),
        }),
      );

      expect(payInvoice.execute).not.toHaveBeenCalled();
      expect(settlements.claim).not.toHaveBeenCalled();
    });

    it('should pay the invoice due on the activation date', async () => {
      await runAllUnpaid(
        makeCandidate({
          autoPayEnabledAt: new Date('2024-03-15T08:00:00.000Z'),
        }),
      );

      expect(paidMonths()).toEqual([[2024, 3]]);
    });

    it('should ignore invoices from before a re-enable', async () => {
      await runAllUnpaid(
        makeCandidate({
          autoPayEnabledAt: new Date('2024-03-10T08:00:00.000Z'),
        }),
      );

      expect(paidMonths()).toEqual([[2024, 3]]);
    });

    it('should judge the activation date in the card timezone', async () => {
      await runAllUnpaid(
        makeCandidate({
          timezone: 'America/Sao_Paulo',
          autoPayEnabledAt: new Date('2024-03-16T02:30:00.000Z'),
        }),
      );

      expect(paidMonths()).toEqual([[2024, 3]]);
    });

    it('should not count an already paid invoice toward the cap', async () => {
      settlements.findAutopayCandidates.mockResolvedValueOnce([
        makeCandidate({
          autoPayEnabledAt: new Date('2020-01-01T00:00:00.000Z'),
        }),
      ]);
      settlements.countAutopayCandidates.mockResolvedValue(1);
      getInvoice.execute.mockImplementation(async ({ month, year }) =>
        right(
          invoiceOf(
            year === 2024 && month === 1 ? { invoiceStatus: 'paid' } : {},
          ) as never,
        ),
      );

      await service.execute();

      expect(paidMonths()).toEqual([
        [2023, 12],
        [2024, 2],
        [2024, 3],
      ]);
    });

    it('should take the oldest three eligible invoices', async () => {
      await runAllUnpaid(
        makeCandidate({
          autoPayEnabledAt: new Date('2020-01-01T00:00:00.000Z'),
        }),
      );

      expect(paidMonths()).toEqual([
        [2023, 12],
        [2024, 1],
        [2024, 2],
      ]);
    });
  });
});
