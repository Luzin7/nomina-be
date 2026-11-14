import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  InvoiceCalendar,
  PlainDate,
} from '@modules/account/valueObjects/InvoiceCalendar';
import { CardCycleNotConfiguredError } from '@modules/card-cycle/errors';
import {
  CardCyclePeriodRecord,
  CardCycleRepository,
} from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { CardCycleWindow } from '@modules/card-cycle/valueObjects/CardCycleWindow';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
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
import { GetCardCycleStatusRequest } from './get-card-cycle-status.dto';

type Request = GetCardCycleStatusRequest &
  Pick<TokenPayloadSchema, 'workspaceId'> & { accountId: string };

export type CardCycleStatusResponse = {
  accountId: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  limitCents: number | null;
  cycleSpendCents: number;
  availableCents: number | null;
  materializedAt: Date;
};

type ResolveWindowInput = {
  dueDate: PlainDate | undefined;
  dueDay: number;
  closingDaysBeforeDue: number;
  timezone: string;
};

type ResolvePeriodInput = {
  workspaceId: string;
  account: CreditCard;
  dueDay: number;
  dueDate: PlainDate | undefined;
};

@Injectable()
export class GetCardCycleStatusService implements Service<
  Request,
  Error,
  CardCycleStatusResponse
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cardCycleRepository: CardCycleRepository,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, CardCycleStatusResponse>> {
    const account = await this.accountRepository.findById(request.accountId);

    if (!account) return left(new AccountNotFoundError());

    if (account.workspaceId !== request.workspaceId)
      return left(new UnauthorizedError());

    if (!(account instanceof CreditCard)) return left(new AccountTypeError());

    const dueDay: number | null = account.dueDay;
    if (dueDay === null) return left(new CardCycleNotConfiguredError());

    const generation = await readLedgerGeneration(
      this.cache,
      request.workspaceId,
    );
    const localDay = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      account.timezone,
    );

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'account:cycle',
        version: 'v2',
        workspaceId: request.workspaceId,
        generations: { ledger: generation },
        parts: [request.accountId, request.dueDate, localDay],
      }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      load: () => this.computeStatus(request, account, dueDay),
    });
  }

  private async computeStatus(
    request: Request,
    account: CreditCard,
    dueDay: number,
  ): Promise<Either<Error, CardCycleStatusResponse>> {
    const period = await this.resolvePeriod({
      workspaceId: request.workspaceId,
      account,
      dueDay,
      dueDate: request.dueDate,
    });
    const [budget, cycleSpendCents] = await Promise.all([
      this.cardCycleRepository.findApplicableBudget(
        request.workspaceId,
        account.id,
        period.dueDate,
      ),
      this.cardCycleRepository.sumCycleSpend({
        workspaceId: request.workspaceId,
        accountId: account.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        timezone: account.timezone,
      }),
    ]);
    const limitCents = budget === null ? null : budget.limitCents;

    return right({
      accountId: account.id,
      dueDate: period.dueDate,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      limitCents,
      cycleSpendCents,
      availableCents: limitCents === null ? null : limitCents - cycleSpendCents,
      materializedAt: period.materializedAt,
    });
  }

  private async resolvePeriod({
    workspaceId,
    account,
    dueDay,
    dueDate,
  }: ResolvePeriodInput): Promise<CardCyclePeriodRecord> {
    if (dueDate) {
      const stored = await this.cardCycleRepository.findPeriod(
        workspaceId,
        account.id,
        dueDate,
      );

      if (stored) return stored;
    }

    const window = this.resolveWindow({
      dueDate,
      dueDay,
      closingDaysBeforeDue: account.closingDaysBeforeDue,
      timezone: account.timezone,
    });

    return this.cardCycleRepository.materializePeriod({
      workspaceId,
      accountId: account.id,
      window: window.toRecord(),
    });
  }

  private resolveWindow({
    dueDate,
    dueDay,
    closingDaysBeforeDue,
    timezone,
  }: ResolveWindowInput): CardCycleWindow {
    if (dueDate) {
      return CardCycleWindow.create({
        dueDate,
        dueDay,
        closingDaysBeforeDue,
      });
    }

    const calendar = new InvoiceCalendar({ dueDay, closingDaysBeforeDue });
    const today = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );
    const current = calendar.bounds(calendar.invoiceKeyFor(today));

    return CardCycleWindow.create({
      dueDate: current.dueDate,
      dueDay,
      closingDaysBeforeDue,
    });
  }
}
