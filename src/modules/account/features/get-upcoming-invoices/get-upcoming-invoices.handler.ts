import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
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
import { cardInvoiceWindowOf } from '@modules/account/valueObjects/CardInvoiceWindow';
import {
  InvoiceBounds,
  InvoiceCalendar,
  InvoiceKey,
} from '@modules/account/valueObjects/InvoiceCalendar';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { nextOccurrenceAfter } from '@utils/installmentSchedule';
import { walkOccurrences } from '@utils/recurrenceWalk';

export const UPCOMING_INVOICE_COUNT = 6;

type Request = TokenPayloadBase & { accountId: string };

export type UpcomingInvoice = {
  key: InvoiceKey;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  pendingChargesCents: number;
  projectedCents: number;
  committedCents: number;
};

export type UpcomingInvoicesResponse = { invoices: UpcomingInvoice[] };

type UpcomingPlan = {
  account: CreditCard;
  calendar: InvoiceCalendar;
  today: string;
  bounds: InvoiceBounds[];
};

type ProjectionInput = {
  recurrences: CardRecurrence[];
  from: Date;
  to: Date;
  plan: UpcomingPlan;
};

const LOCAL_DAY_FORMAT = 'YYYY-MM-DD';

@Injectable()
export class GetUpcomingInvoicesService implements Service<
  Request,
  Error,
  UpcomingInvoicesResponse
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cardInvoiceRepository: CardInvoiceRepository,
    private readonly cardRecurrenceRepository: CardRecurrenceRepository,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, UpcomingInvoicesResponse>> {
    const account = await this.accountRepository.findById(request.accountId);

    if (!account) return left(new AccountNotFoundError());

    if (account.workspaceId !== request.workspaceId)
      return left(new UnauthorizedError());

    if (!(account instanceof CreditCard)) return left(new AccountTypeError());

    if (account.dueDay === null) {
      return left(new CreditCardCycleNotConfiguredError());
    }

    const plan = this.planOf(account, account.dueDay);
    const generation = await readLedgerGeneration(
      this.cache,
      request.workspaceId,
    );

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'account:upcoming-invoices',
        version: 'v1',
        workspaceId: request.workspaceId,
        generations: { ledger: generation },
        parts: [account.id, plan.today],
      }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      load: () => this.compute(request.workspaceId, plan),
    });
  }

  private planOf(account: CreditCard, dueDay: number): UpcomingPlan {
    const calendar = new InvoiceCalendar({
      closingDaysBeforeDue: account.closingDaysBeforeDue,
      dueDay,
    });
    const today = this.dateProvider.format(
      this.dateProvider.now(),
      LOCAL_DAY_FORMAT,
      account.timezone,
    );
    const keys: InvoiceKey[] = [];
    let cursor = calendar.invoiceKeyFor(today);

    for (let step = 0; step < UPCOMING_INVOICE_COUNT; step++) {
      cursor = calendar.nextKey(cursor);
      keys.push(cursor);
    }

    return {
      account,
      calendar,
      today,
      bounds: keys.map((key) => calendar.bounds(key)),
    };
  }

  private async compute(
    workspaceId: string,
    plan: UpcomingPlan,
  ): Promise<Either<Error, UpcomingInvoicesResponse>> {
    const { account, calendar, today, bounds } = plan;
    const from = this.dateProvider.startOfDay(
      bounds[0].periodStart,
      account.timezone,
    );
    const to = this.dateProvider.startOfDay(
      bounds[bounds.length - 1].endExclusive,
      account.timezone,
    );

    const [totals, recurrences] = await Promise.all([
      this.cardInvoiceRepository.findTotals(
        workspaceId,
        bounds.map(({ key }) =>
          cardInvoiceWindowOf(account, calendar, key, today),
        ),
      ),
      this.cardRecurrenceRepository.findCardRecurrences({
        workspaceId,
        accountId: account.id,
        from,
        to,
      }),
    ]);
    const projectedByKey = this.projectedCentsByKey({
      recurrences,
      from,
      to,
      plan,
    });

    return right({
      invoices: bounds.map((invoiceBounds, index) => {
        const pendingChargesCents = Number(totals[index].pendingCharges);
        const projectedCents = projectedByKey.get(invoiceBounds.key) ?? 0;

        return {
          key: invoiceBounds.key,
          periodStart: invoiceBounds.periodStart,
          periodEnd: invoiceBounds.periodEnd,
          dueDate: invoiceBounds.dueDate,
          pendingChargesCents,
          projectedCents,
          committedCents: pendingChargesCents + projectedCents,
        };
      }),
    });
  }

  private projectedCentsByKey({
    recurrences,
    from,
    to,
    plan: { account, calendar },
  }: ProjectionInput): Map<InvoiceKey, number> {
    const projected = new Map<InvoiceKey, number>();
    const until = new Date(to.getTime() - 1);

    for (const rule of recurrences) {
      const dates = walkOccurrences({
        rule,
        from,
        until,
        nextOccurrence: (date) =>
          nextOccurrenceAfter(
            {
              startDate: rule.startDate,
              frequency: rule.frequency,
              interval: rule.interval,
              timezone: account.timezone,
            },
            date,
            this.dateProvider,
          ),
      });

      for (const date of dates) {
        const key = calendar.invoiceKeyFor(
          this.dateProvider.format(date, LOCAL_DAY_FORMAT, account.timezone),
        );
        projected.set(key, (projected.get(key) ?? 0) + rule.amount);
      }
    }

    return projected;
  }
}
