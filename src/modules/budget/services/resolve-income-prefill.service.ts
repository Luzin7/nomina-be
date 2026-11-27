import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  lookbackRange,
  resolveIncomeBasis,
} from '@modules/budget/valueObjects/IncomeBasis';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { Injectable } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';

export type IncomePrefill = {
  cents: number | null;
  source: 'recurring' | 'inferred' | 'none';
};

export type ResolveIncomePrefillRequest = {
  workspaceId: string;
  timezone: string;
};

@Injectable()
export class ResolveIncomePrefillService {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly monthProjectionRepository: MonthProjectionRepository,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute({
    workspaceId,
    timezone,
  }: ResolveIncomePrefillRequest): Promise<IncomePrefill> {
    const recurring =
      await this.budgetRepository.findRecurringMonthlyIncomeCents(workspaceId);
    if (recurring !== null) return { cents: recurring, source: 'recurring' };

    const inferred = await this.inferFromHistory(workspaceId, timezone);
    if (inferred !== null) return { cents: inferred, source: 'inferred' };

    return { cents: null, source: 'none' };
  }

  private async inferFromHistory(
    workspaceId: string,
    timezone: string,
  ): Promise<number | null> {
    const now = this.dateProvider.now();
    const currentMonth = this.dateProvider.format(now, 'YYYY-MM', timezone);
    const currentMonthStart = this.dateProvider.startOfMonth(
      `${currentMonth}-01`,
      timezone,
    );
    const range = lookbackRange(this.dateProvider, currentMonthStart, timezone);
    const [ledger, totals] = await Promise.all([
      this.monthProjectionRepository.findMonthLedger({
        workspaceId,
        timezone,
        range,
        currentMonthStart,
      }),
      this.budgetRepository.findInferenceTotals({
        workspaceId,
        timezone,
        ...range,
      }),
    ]);

    return (
      resolveIncomeBasis(ledger, totals, currentMonth).inference?.incomeCents ??
      null
    );
  }
}
