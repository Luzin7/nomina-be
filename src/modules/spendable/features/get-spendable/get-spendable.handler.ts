import {
  AccountType,
  isValidDueDay,
  normalizeWorkspaceCycle,
  type WorkspaceCycle,
} from '@constants/enums';
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
  type InvoiceKey,
  type PlainDate,
} from '@modules/account/valueObjects/InvoiceCalendar';
import {
  openInvoiceOf,
  payableInvoiceOf,
} from '@modules/account/valueObjects/OpenInvoice';
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

type DatedCardDraft = {
  card: CreditCard;
  calendar: InvoiceCalendar;
  current: InvoiceBounds;
  candidate: InvoiceBounds;
  keys: InvoiceKey[];
  windows: CardInvoiceWindow[];
  totals: CardInvoiceTotals[];
};

type UndatedCardDraft = {
  card: CreditCard;
  undated: CardWithoutDueDate;
  windows: CardInvoiceWindow[];
  totals: CardInvoiceTotals[];
};

type CardDraft = DatedCardDraft | UndatedCardDraft;

type CardDraftInput = {
  card: CreditCard;
  today: PlainDate;
  window: CycleWindow;
};

type CardContext = {
  workspaceId: string;
  accounts: AnyAccount[];
  cashAccountIds: ReadonlySet<string>;
  today: PlainDate;
  window: CycleWindow;
};

type CardPlansInput = CardContext & { cards: CreditCard[] };

type CardResolutionInput = {
  draft: CardDraft;
  workspaceId: string;
  accounts: AnyAccount[];
  cashAccountIds: ReadonlySet<string>;
  window: CycleWindow;
};

type ScheduledTotals = {
  expensesCents: number;
  incomeCents: number;
};

type ScheduledTotalsInput = {
  recurrences: SpendableRecurrence[];
  window: CycleWindow;
  timezone: string;
};

const isCashType = (type: string): boolean =>
  type === AccountType.CHECKING || type === AccountType.CASH;

const isUsableDueDay = (dueDay: number | null): dueDay is number =>
  dueDay !== null && isValidDueDay(dueDay);

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
    const { cashBalances, pendingCents: pendingExpensesCents } =
      await this.spendableRepository.readCashSnapshot({
        workspaceId,
        startDate: window.startDate,
        endDate: window.endDate,
        timezone,
      });
    const cashAccountIds = new Set(cashBalances.map((cash) => cash.accountId));

    const [completedIncomeCents, recurrences, cardResolutions] =
      await Promise.all([
        this.spendableRepository.sumCompletedCashIncome({
          workspaceId,
          startDate: window.startDate,
          endDate: window.endDate,
          timezone,
        }),
        this.spendableRepository.listActiveRecurrences(workspaceId),
        this.cardResolutionsOf({
          workspaceId,
          cards,
          accounts,
          cashAccountIds,
          today,
          window,
        }),
      ]);

    const scheduled = this.scheduledTotalsOf({ recurrences, window, timezone });
    const cashCents = cashBalances.reduce(
      (total, cash) => total + cash.balanceCents,
      0,
    );
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
      rule: { ...rule, lastGenerated: this.walkAnchorOf(rule, from) },
      from,
      until,
      nextOccurrence: (date, current) =>
        nextOccurrenceAfter(
          {
            startDate: current.startDate,
            frequency: current.frequency,
            interval: current.interval,
            timezone: current.timezone,
          },
          date,
          this.dateProvider,
        ),
    });

    return occurrences.length * rule.amount;
  }

  private walkAnchorOf(rule: SpendableRecurrence, from: Date): Date {
    const generated = rule.lastGenerated;
    if (generated !== null && generated.getTime() >= from.getTime())
      return generated;
    return new Date(from.getTime() - 1);
  }

  private async cardResolutionsOf({
    workspaceId,
    cards,
    accounts,
    cashAccountIds,
    today,
    window,
  }: CardPlansInput): Promise<CardResolution[]> {
    const drafts = cards.map((card) => this.draftOf({ card, today, window }));
    const windows = drafts.flatMap((draft) => draft.windows);
    const totals =
      windows.length === 0
        ? []
        : await this.cardInvoiceRepository.findTotals(workspaceId, windows);
    let cursor = 0;
    const withTotals = drafts.map((draft) => {
      const billTotals = totals.slice(cursor, cursor + draft.windows.length);
      cursor += draft.windows.length;

      return { ...draft, totals: billTotals };
    });

    return Promise.all(
      withTotals.map((draft) =>
        this.resolutionOf({
          draft,
          workspaceId,
          accounts,
          cashAccountIds,
          window,
        }),
      ),
    );
  }

  private draftOf({ card, today, window }: CardDraftInput): CardDraft {
    const dueDay = card.dueDay;
    if (!isUsableDueDay(dueDay))
      return {
        card,
        undated: this.undatedCardOf(card),
        windows: [],
        totals: [],
      };

    const calendar = new InvoiceCalendar({
      dueDay,
      closingDaysBeforeDue: card.closingDaysBeforeDue,
    });
    const current = calendar.bounds(calendar.invoiceKeyFor(today));
    const candidate = openInvoiceOf(calendar, current, window);
    const keys =
      candidate.key !== current.key
        ? [candidate.key, current.key]
        : [current.key];

    return {
      card,
      calendar,
      current,
      candidate,
      keys,
      windows: keys.map((key) =>
        cardInvoiceWindowOf(card, calendar, key, today),
      ),
      totals: [],
    };
  }

  private async resolutionOf({
    draft,
    workspaceId,
    accounts,
    cashAccountIds,
    window,
  }: CardResolutionInput): Promise<CardResolution> {
    if ('undated' in draft)
      return { card: null, undated: draft.undated, invoiceCents: 0 };

    const { card, current, candidate, keys, totals } = draft;

    const statementOf = (key: InvoiceKey) =>
      buildInvoiceStatementFromTotals(totals[keys.indexOf(key)]);
    const payable = payableInvoiceOf(
      current,
      candidate,
      (key) => statementOf(key).remaining,
    );
    const [budget, spendCents] = await Promise.all([
      this.cardCycleRepository.findApplicableBudget(
        workspaceId,
        card.id,
        current.dueDate,
      ),
      this.spendOn(workspaceId, card, current),
    ]);
    const headroom =
      budget === null
        ? null
        : CardHeadroom.of({
            accountId: card.id,
            name: card.name,
            dueDate: payable.dueDate,
            limitCents: budget.limitCents,
            spendCents,
          });
    const owedInCycle =
      payable.key === candidate.key || window.contains(payable.dueDate);
    const invoiceCents =
      owedInCycle && this.fundsFromCash(card, accounts, cashAccountIds)
        ? Number(statementOf(payable.key).remaining)
        : 0;

    return { card: headroom, undated: null, invoiceCents };
  }

  private undatedCardOf(card: CreditCard): CardWithoutDueDate {
    return CardWithoutDueDate.of({
      accountId: card.id,
      name: card.name,
      limitCents: card.creditLimit === null ? null : Number(card.creditLimit),
    });
  }

  private fundsFromCash(
    card: CreditCard,
    accounts: AnyAccount[],
    cashAccountIds: ReadonlySet<string>,
  ): boolean {
    if (!card.autoPayEnabled) return true;

    const source = accounts.find(
      (account) => account.id === card.autoPaySourceAccountId,
    );

    return source === undefined || cashAccountIds.has(source.id);
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
