import {
  AccountType,
  normalizeWorkspaceCycle,
  type WorkspaceCycle,
} from '@constants/enums';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import type { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import {
  cardInvoiceWindowOf,
  type CardInvoiceTotals,
  type CardInvoiceWindow,
} from '@modules/account/valueObjects/CardInvoiceWindow';
import {
  InvoiceCalendar,
  type InvoiceBounds,
  type PlainDate,
} from '@modules/account/valueObjects/InvoiceCalendar';
import { buildInvoiceStatementFromTotals } from '@modules/account/valueObjects/InvoiceStatement';
import { CardCycleRepository } from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import type { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_LIVE_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { nextOccurrenceAfter } from '@utils/installmentSchedule';
import { walkOccurrences } from '@utils/recurrenceWalk';
import { SpendableWorkspaceNotFoundError } from '../../errors';
import {
  SpendableRecurrence,
  SpendableRepository,
} from '../../repositories/contracts/SpendableRepository';
import { CardHeadroom } from '../../valueObjects/CardHeadroom';
import { CardWithoutDueDate } from '../../valueObjects/CardWithoutDueDate';
import { CycleWindow } from '../../valueObjects/CycleWindow';
import { SpendableFigure } from '../../valueObjects/SpendableFigure';
import {
  SpendablePresenter,
  type SpendablePayload,
} from '../../presenters/Spendable.presenter';

type Request = Pick<TokenPayloadSchema, 'workspaceId'>;

export type GetSpendableResult = {
  cycle: WorkspaceCycle;
  window: CycleWindow;
  figure: SpendableFigure;
  cards: CardHeadroom[];
  undatedCards: CardWithoutDueDate[];
};

type ComputeInput = Request & {
  cycle: WorkspaceCycle;
  timezone: string;
  today: PlainDate;
};

type CardResolution = {
  card: CardHeadroom | null;
  undated: CardWithoutDueDate | null;
  invoiceCents: number;
};

type InvoicePlan = {
  card: CreditCard;
  window: CardInvoiceWindow;
};

type CardPlan = {
  card: CreditCard;
  headroom: CardHeadroom | null;
  undated: CardWithoutDueDate | null;
  invoice: InvoicePlan | null;
};

type CardContext = {
  workspaceId: string;
  accounts: AnyAccount[];
  today: PlainDate;
  window: CycleWindow;
};

type CardPlansInput = CardContext & { cards: CreditCard[] };

type CardPlanInput = CardContext & { card: CreditCard };

type ScheduledTotals = {
  expensesCents: number;
  incomeCents: number;
};

type ScheduledTotalsInput = {
  recurrences: SpendableRecurrence[];
  window: CycleWindow;
  timezone: string;
};

type InvoicePlanInput = {
  card: CreditCard;
  accounts: AnyAccount[];
  calendar: InvoiceCalendar;
  current: InvoiceBounds;
  window: CycleWindow;
  today: PlainDate;
};

const isCashType = (type: string): boolean =>
  type === AccountType.CHECKING || type === AccountType.CASH;

const isCashAccount = (account: AnyAccount): boolean =>
  isCashType(account.type);

const isCreditCard = (account: AnyAccount): account is CreditCard =>
  account instanceof CreditCard;

@Injectable()
export class GetSpendableService implements Service<
  Request,
  Error,
  SpendablePayload
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cardCycleRepository: CardCycleRepository,
    private readonly cardInvoiceRepository: CardInvoiceRepository,
    private readonly spendableRepository: SpendableRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, SpendablePayload>> {
    const storedCycle = await this.spendableRepository.findCycle(workspaceId);
    if (storedCycle === null)
      return left(new SpendableWorkspaceNotFoundError());

    const cycle = normalizeWorkspaceCycle(storedCycle);
    const [timezone, ledger] = await Promise.all([
      this.workspaceTimezone.execute(workspaceId),
      readLedgerGeneration(this.cache, workspaceId),
    ]);
    const today = this.localToday(timezone);

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'spendable:get',
        version: 'v1',
        workspaceId,
        generations: { ledger },
        parts: [cycle, today],
      }),
      ttlSeconds: LEDGER_LIVE_CACHE_TTL_SECONDS,
      load: () => this.compute({ workspaceId, cycle, timezone, today }),
    });
  }

  private async compute({
    workspaceId,
    cycle,
    timezone,
    today,
  }: ComputeInput): Promise<Either<Error, SpendablePayload>> {
    const accounts =
      await this.accountRepository.findAllByWorkspaceId(workspaceId);
    const window = CycleWindow.of(today, cycle);
    const cards = accounts.filter(isCreditCard);

    const [
      pendingExpensesCents,
      completedIncomeCents,
      recurrences,
      cardResolutions,
    ] = await Promise.all([
      this.spendableRepository.sumPendingCashExpenses({
        workspaceId,
        startDate: window.startDate,
        endDate: window.endDate,
        timezone,
      }),
      this.spendableRepository.sumCompletedCashIncome({
        workspaceId,
        startDate: window.startDate,
        endDate: window.endDate,
        timezone,
      }),
      this.spendableRepository.listActiveRecurrences(workspaceId),
      this.cardResolutionsOf({ workspaceId, cards, accounts, today, window }),
    ]);

    const scheduled = this.scheduledTotalsOf({ recurrences, window, timezone });
    const cashCents = this.cashBalanceOf(accounts);
    const cardHeadrooms = cardResolutions
      .map((resolution) => resolution.card)
      .filter((card): card is CardHeadroom => card !== null);
    const undatedCards = cardResolutions
      .map((resolution) => resolution.undated)
      .filter((card): card is CardWithoutDueDate => card !== null);
    const obligationsCents =
      pendingExpensesCents +
      scheduled.expensesCents +
      cardResolutions.reduce(
        (total, resolution) => total + resolution.invoiceCents,
        0,
      );

    const figure = SpendableFigure.of({
      cashCents,
      obligationsCents,
      incomeCents: completedIncomeCents + scheduled.incomeCents,
      cards: cardHeadrooms,
    });

    return right(
      SpendablePresenter.toHTTP({
        cycle,
        window,
        figure,
        cards: cardHeadrooms,
        undatedCards,
      }),
    );
  }

  private localToday(timezone: string): PlainDate {
    return this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );
  }

  private cashBalanceOf(accounts: AnyAccount[]): number {
    return accounts
      .filter(isCashAccount)
      .reduce((total, account) => total + Number(account.balance), 0);
  }

  private scheduledTotalsOf({
    recurrences,
    window,
    timezone,
  }: ScheduledTotalsInput): ScheduledTotals {
    const from = this.dateProvider.startOfDay(window.startDate, timezone);
    const until = this.dateProvider.endOfDay(window.endDate, timezone);
    const totals: ScheduledTotals = { expensesCents: 0, incomeCents: 0 };

    for (const rule of recurrences) {
      if (!isCashType(rule.accountType)) continue;

      const cents = this.occurrencesCentsOf(rule, { from, until });
      if (rule.type === 'EXPENSE') totals.expensesCents += cents;
      if (rule.type === 'INCOME') totals.incomeCents += cents;
    }

    return totals;
  }

  private occurrencesCentsOf(
    rule: SpendableRecurrence,
    { from, until }: { from: Date; until: Date },
  ): number {
    const occurrences = walkOccurrences({
      rule,
      from,
      until,
      nextOccurrence: (date, current) =>
        nextOccurrenceAfter(
          {
            startDate: current.startDate,
            frequency: current.frequency,
            interval: current.interval,
            timezone: RECURRING_GENERATION_TIMEZONE,
          },
          date,
          this.dateProvider,
        ),
    });

    return occurrences.length * rule.amount;
  }

  private async cardResolutionsOf({
    workspaceId,
    cards,
    accounts,
    today,
    window,
  }: CardPlansInput): Promise<CardResolution[]> {
    const plans = await Promise.all(
      cards.map((card) =>
        this.planCard({ workspaceId, card, accounts, today, window }),
      ),
    );
    const invoices = plans.flatMap((plan) =>
      plan.invoice === null ? [] : [plan.invoice],
    );
    const totals = await this.invoiceTotalsOf(workspaceId, invoices);
    const remainingByCard = new Map(
      invoices.map((invoice, index) => [
        invoice.card.id,
        Number(buildInvoiceStatementFromTotals(totals[index]).remaining),
      ]),
    );

    return plans.map((plan) => ({
      card: plan.headroom,
      undated: plan.undated,
      invoiceCents: remainingByCard.get(plan.card.id) ?? 0,
    }));
  }

  private invoiceTotalsOf(
    workspaceId: string,
    invoices: InvoicePlan[],
  ): Promise<CardInvoiceTotals[]> {
    if (invoices.length === 0) return Promise.resolve([]);

    return this.cardInvoiceRepository.findTotals(
      workspaceId,
      invoices.map((invoice) => invoice.window),
    );
  }

  private async planCard({
    workspaceId,
    card,
    accounts,
    today,
    window,
  }: CardPlanInput): Promise<CardPlan> {
    const dueDay = card.dueDay;
    if (dueDay === null)
      return {
        card,
        headroom: null,
        undated: this.undatedCardOf(card),
        invoice: null,
      };

    const calendar = new InvoiceCalendar({
      dueDay,
      closingDaysBeforeDue: card.closingDaysBeforeDue,
    });
    const current = calendar.bounds(calendar.invoiceKeyFor(today));
    const [budget, currentSpendCents] = await Promise.all([
      this.cardCycleRepository.findApplicableBudget(
        workspaceId,
        card.id,
        current.dueDate,
      ),
      this.spendOn(workspaceId, card, current),
    ]);

    return {
      card,
      headroom:
        budget === null
          ? null
          : CardHeadroom.of({
              accountId: card.id,
              name: card.name,
              dueDate: current.dueDate,
              limitCents: budget.limitCents,
              spendCents: currentSpendCents,
            }),
      undated: null,
      invoice: this.invoicePlanOf({
        card,
        accounts,
        calendar,
        current,
        window,
        today,
      }),
    };
  }

  private undatedCardOf(card: CreditCard): CardWithoutDueDate {
    return CardWithoutDueDate.of({
      accountId: card.id,
      name: card.name,
      limitCents: card.creditLimit === null ? null : Number(card.creditLimit),
    });
  }

  private invoicePlanOf({
    card,
    accounts,
    calendar,
    current,
    window,
    today,
  }: InvoicePlanInput): InvoicePlan | null {
    const bounds = this.billInWindowOf(calendar, current, window);
    if (bounds === null) return null;
    if (!this.fundsFromCash(card, accounts)) return null;

    return {
      card,
      window: cardInvoiceWindowOf(card, calendar, bounds.key, today),
    };
  }

  private billInWindowOf(
    calendar: InvoiceCalendar,
    current: InvoiceBounds,
    window: CycleWindow,
  ): InvoiceBounds | null {
    if (window.contains(current.dueDate)) return current;

    const previous = calendar.bounds(calendar.previousKey(current.key));

    return window.contains(previous.dueDate) ? previous : null;
  }

  private fundsFromCash(card: CreditCard, accounts: AnyAccount[]): boolean {
    if (!card.autoPayEnabled) return true;

    const source = accounts.find(
      (account) => account.id === card.autoPaySourceAccountId,
    );

    return source === undefined || isCashAccount(source);
  }

  private spendOn(
    workspaceId: string,
    card: CreditCard,
    bounds: InvoiceBounds,
  ): Promise<number> {
    return this.cardCycleRepository.sumCycleSpend({
      workspaceId,
      accountId: card.id,
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      timezone: card.timezone,
    });
  }
}
