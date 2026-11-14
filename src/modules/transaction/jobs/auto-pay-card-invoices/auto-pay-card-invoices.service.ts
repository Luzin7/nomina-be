import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { GetCreditCardInvoiceService } from '@modules/account/features/get-credit-card-invoice/get-credit-card-invoice.handler';
import { AccountNotFoundError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { InvoiceCalendar } from '@modules/account/valueObjects/InvoiceCalendar';
import { Transaction } from '@modules/transaction/entities/Transaction';
import {
  CardInvoiceAutopayFailedError,
  CardInvoiceAutopayFailureError,
} from '@modules/transaction/errors';
import { PayCreditCardInvoiceService } from '@modules/transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.service';
import {
  AutopayCandidate,
  CardInvoiceSettlementRepository,
  InvoicePeriod,
} from '@modules/transaction/repositories/contracts/CardInvoiceSettlementRepository';
import { Injectable, Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { captureException } from '@sentry/nestjs';
import { getErrorDetails } from '@shared/utils/error-details';

const LOCK_KEY = 'job:auto-pay-card-invoices';
const LOCK_TTL_SECONDS = 300;
const TIME_BUDGET_MS = 25_000;
const BATCH_SIZE = 100;
const MAX_INVOICES_PER_CARD = 3;
const CLAIM_TTL_MINUTES = 30;
const CLAIM_TTL_MS = CLAIM_TTL_MINUTES * 60_000;
const SYSTEM_ACTOR_ID = 'system:auto-pay-card-invoices';
const PROBE_MONTHS_BACK = 3;
const PROBE_MONTHS_AHEAD = 1;
const CLAIM_ATTEMPTS = 2;

export type AutopaySkipReason =
  | 'already-paid'
  | 'already-settled'
  | 'settled-by-another-run'
  | 'nothing-to-pay'
  | 'insufficient-balance'
  | 'disabled';

export type AutopayOutcome =
  | 'nothing-due'
  | 'success'
  | 'partial-failure'
  | 'total-failure';

export interface AutopaySummary {
  outcome: AutopayOutcome;
  settledCount: number;
  failedCount: number;
  skipped: Record<AutopaySkipReason, number>;
  processedCount: number;
  remainingCount: number;
  lockBusy: boolean;
}

type InvoiceResult = 'settled' | 'failed' | AutopaySkipReason;
type Tally = Record<InvoiceResult, number>;

interface InvoiceContext extends InvoicePeriod {
  card: AutopayCandidate;
}

interface InvoiceSnapshot {
  invoiceStatus: string;
  totalAmount: bigint;
}

type ClaimResult =
  | { claimId: string; skip?: undefined }
  | { skip: AutopaySkipReason };

type FundedPayment =
  | { transaction: Transaction }
  | { insufficientAvailable: bigint };

const NO_ATTEMPT_RESULTS: InvoiceResult[] = ['already-paid', 'nothing-to-pay'];

const newTally = (): Tally => ({
  settled: 0,
  failed: 0,
  'already-paid': 0,
  'already-settled': 0,
  'settled-by-another-run': 0,
  'nothing-to-pay': 0,
  'insufficient-balance': 0,
  disabled: 0,
});

const keyOf = ({ month, year }: InvoicePeriod): string =>
  `${year}-${String(month).padStart(2, '0')}`;

const shiftMonth = (
  today: string,
  delta: number,
): { year: number; month: number } => {
  const [year, month] = today.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

const probeKeysOf = (today: string): string[] =>
  Array.from(
    { length: PROBE_MONTHS_BACK + PROBE_MONTHS_AHEAD + 1 },
    (_, index) => {
      const { year, month } = shiftMonth(today, index - PROBE_MONTHS_BACK);
      return keyOf({ month, year });
    },
  );

const periodOfKey = (key: string): InvoicePeriod => {
  const [year, month] = key.split('-').map(Number);
  return { month, year };
};

function classifyOutcome(tally: Tally, processedCount: number): AutopayOutcome {
  if (processedCount === 0) return 'nothing-due';
  if (tally.failed === 0) return 'success';
  if (tally.settled === 0) return 'total-failure';
  return 'partial-failure';
}

@Injectable()
export class AutoPayCardInvoicesJobService {
  private readonly logger = new Logger(AutoPayCardInvoicesJobService.name);

  constructor(
    private readonly settlements: CardInvoiceSettlementRepository,
    private readonly accountRepository: AccountRepository,
    private readonly getInvoice: GetCreditCardInvoiceService,
    private readonly payInvoice: PayCreditCardInvoiceService,
    private readonly cache: CacheProvider,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(): Promise<AutopaySummary> {
    const lock = await this.cache.acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
    if (!lock) {
      this.logger.warn(
        `${AutoPayCardInvoicesJobService.name} skipped: lock busy, another run holds ${LOCK_KEY}`,
      );
      return this.summaryOf(newTally(), 0, true);
    }

    try {
      return await this.run();
    } finally {
      await this.cache.releaseLock(lock);
    }
  }

  private async run(): Promise<AutopaySummary> {
    const startedAt = this.dateProvider.now();
    const totalCards = await this.settlements.countAutopayCandidates();
    const tally = newTally();
    let startedCards = 0;
    let cursor: string | null = null;

    while (startedCards < totalCards) {
      const batch = await this.settlements.findAutopayCandidates(
        cursor,
        BATCH_SIZE,
      );
      if (batch.length === 0) break;

      for (const card of batch) {
        if (startedCards > 0 && this.isOverBudget(startedAt)) {
          return this.summaryOf(tally, totalCards - startedCards);
        }
        startedCards += 1;
        await this.processCard(card, startedAt, tally);
      }
      cursor = batch[batch.length - 1].cardAccountId;
    }

    return this.summaryOf(tally, Math.max(totalCards - startedCards, 0));
  }

  private summaryOf(
    tally: Tally,
    remainingCount: number,
    lockBusy = false,
  ): AutopaySummary {
    const { settled, failed, ...skipped } = tally;
    const processedCount =
      settled + failed + Object.values(skipped).reduce((a, b) => a + b, 0);

    return {
      outcome: classifyOutcome(tally, processedCount),
      settledCount: settled,
      failedCount: failed,
      skipped,
      processedCount,
      remainingCount,
      lockBusy,
    };
  }

  private isOverBudget(startedAt: Date): boolean {
    return (
      this.dateProvider.now().getTime() - startedAt.getTime() >= TIME_BUDGET_MS
    );
  }

  private async processCard(
    card: AutopayCandidate,
    startedAt: Date,
    tally: Tally,
  ): Promise<void> {
    try {
      let attempted = 0;
      for (const period of this.duePeriodsOf(card, startedAt)) {
        if (attempted >= MAX_INVOICES_PER_CARD) break;
        const result = await this.settleInvoice({ card, ...period });
        tally[result] += 1;
        if (!NO_ATTEMPT_RESULTS.includes(result)) attempted += 1;
      }
    } catch (error) {
      tally.failed += 1;
      this.reportFailure(
        { card, month: 0, year: 0 },
        new CardInvoiceAutopayFailureError({
          step: 'resolve-periods',
          cause: error,
        }),
      );
    }
  }

  private duePeriodsOf(
    card: AutopayCandidate,
    startedAt: Date,
  ): InvoicePeriod[] {
    const today = this.dateProvider.format(
      startedAt,
      'YYYY-MM-DD',
      card.timezone,
    );
    const calendar = new InvoiceCalendar({
      closingDaysBeforeDue: card.closingDaysBeforeDue,
      dueDay: card.dueDay,
    });

    const enabledOn = this.dateProvider.format(
      card.autoPayEnabledAt,
      'YYYY-MM-DD',
      card.timezone,
    );

    return probeKeysOf(today)
      .filter((key) => {
        const { dueDate } = calendar.bounds(key);
        return dueDate >= enabledOn && dueDate <= today;
      })
      .map(periodOfKey);
  }

  private async settleInvoice(context: InvoiceContext): Promise<InvoiceResult> {
    try {
      return await this.attemptSettlement(context);
    } catch (error) {
      this.reportFailure(context, error);
      return 'failed';
    }
  }

  private async attemptSettlement(
    context: InvoiceContext,
  ): Promise<InvoiceResult> {
    const invoice = await this.loadInvoice(context);
    if (invoice.invoiceStatus === 'paid') return 'already-paid';
    if (invoice.totalAmount <= 0n) return 'nothing-to-pay';

    if (!(await this.isStillEnabled(context.card))) return 'disabled';

    const claim = await this.claim(context);
    if (claim.skip) return claim.skip;

    return this.payClaimed(context, claim.claimId, invoice.totalAmount);
  }

  private isStillEnabled(card: AutopayCandidate): Promise<boolean> {
    return this.settlements.isAutopayActive(
      card.cardAccountId,
      card.sourceAccountId,
    );
  }

  private async loadInvoice({
    card,
    month,
    year,
  }: InvoiceContext): Promise<InvoiceSnapshot> {
    const invoice = await this.getInvoice.execute({
      workspaceId: card.workspaceId,
      sub: SYSTEM_ACTOR_ID,
      accountId: card.cardAccountId,
      month,
      year,
    });
    if (invoice.isLeft()) {
      throw new CardInvoiceAutopayFailureError({
        step: 'load-invoice',
        cause: invoice.value,
      });
    }

    return invoice.value;
  }

  private async claim({
    card,
    month,
    year,
  }: InvoiceContext): Promise<ClaimResult> {
    for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt += 1) {
      const claimId = await this.settlements.claim({
        workspaceId: card.workspaceId,
        cardAccountId: card.cardAccountId,
        month,
        year,
      });
      if (claimId) return { claimId };

      const existing = await this.settlements.findClaim(card.cardAccountId, {
        month,
        year,
      });
      if (!existing) continue;
      if (existing.transactionId) return { skip: 'already-settled' };

      const reclaimable =
        attempt < CLAIM_ATTEMPTS && this.isStale(existing.createdAt);
      if (!reclaimable) return { skip: 'settled-by-another-run' };

      await this.settlements.releaseClaim(existing.id);
    }

    return { skip: 'settled-by-another-run' };
  }

  private isStale(createdAt: Date): boolean {
    return (
      this.dateProvider.now().getTime() - createdAt.getTime() > CLAIM_TTL_MS
    );
  }

  private async payClaimed(
    context: InvoiceContext,
    claimId: string,
    amount: bigint,
  ): Promise<InvoiceResult> {
    const payment = await this.payIfFunded(context, claimId, amount);

    if ('insufficientAvailable' in payment) {
      await this.settlements.releaseClaim(claimId);
      this.warnInsufficientBalance(
        context,
        amount,
        payment.insufficientAvailable,
      );
      return 'insufficient-balance';
    }

    await this.attachTransaction(claimId, payment.transaction, amount);
    return 'settled';
  }

  private async payIfFunded(
    context: InvoiceContext,
    claimId: string,
    amount: bigint,
  ): Promise<FundedPayment> {
    try {
      const available = await this.sourceBalanceOf(context.card);
      if (available < amount) return { insufficientAvailable: available };

      return { transaction: await this.pay(context, amount) };
    } catch (error) {
      await this.settlements.releaseClaim(claimId);
      throw new CardInvoiceAutopayFailureError({
        step: 'pay',
        cause: error,
        amount,
      });
    }
  }

  private async sourceBalanceOf(card: AutopayCandidate): Promise<bigint> {
    const source = await this.accountRepository.findById(card.sourceAccountId);
    if (source?.workspaceId !== card.workspaceId) {
      throw new AccountNotFoundError('Conta de origem não encontrada.');
    }

    return source.balance;
  }

  private async pay(
    { card, month, year }: InvoiceContext,
    amount: bigint,
  ): Promise<Transaction> {
    const paid = await this.payInvoice.execute({
      workspaceId: card.workspaceId,
      sub: SYSTEM_ACTOR_ID,
      creditCardAccountId: card.cardAccountId,
      sourceAccountId: card.sourceAccountId,
      amount: Number(amount),
      month,
      year,
      categoryId: undefined,
    });
    if (paid.isLeft()) throw paid.value;

    return paid.value;
  }

  private async attachTransaction(
    claimId: string,
    transaction: Transaction,
    amount: bigint,
  ): Promise<void> {
    try {
      await this.settlements.attachTransaction(claimId, transaction.id);
    } catch (error) {
      throw new CardInvoiceAutopayFailureError({
        step: 'attach-claim',
        cause: error,
        amount,
      });
    }
  }

  private warnInsufficientBalance(
    { card, month, year }: InvoiceContext,
    needed: bigint,
    available: bigint,
  ): void {
    this.logger.warn(
      `Autopay skipped for insufficient balance: workspace=${card.workspaceId} card=${card.cardAccountId} period=${keyOf({ month, year })} needed=${needed} available=${available}`,
    );
  }

  private reportFailure(context: InvoiceContext, error: unknown): void {
    const failure =
      error instanceof CardInvoiceAutopayFailureError
        ? error
        : new CardInvoiceAutopayFailureError({ step: 'unknown', cause: error });
    const { card, month, year } = context;
    const { sqlState, messageChain } = getErrorDetails(failure.cause);

    this.logger.error(
      `${CardInvoiceAutopayFailedError.name} step=${failure.step} error=${(failure.cause as Error)?.constructor?.name} sqlState=${sqlState ?? 'none'} workspace=${card.workspaceId} card=${card.cardAccountId} period=${keyOf({ month, year })} amount=${failure.amount ?? 'unknown'}: ${messageChain}`,
    );
    captureException(failure, {
      extra: {
        step: failure.step,
        workspaceId: card.workspaceId,
        cardAccountId: card.cardAccountId,
        period: keyOf({ month, year }),
        amount: failure.amount?.toString(),
      },
    });
  }
}
