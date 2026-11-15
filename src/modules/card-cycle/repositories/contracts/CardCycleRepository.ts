import { CardCycleWindowRecord } from '@modules/card-cycle/valueObjects/CardCycleWindow';

export type CardCyclePeriodRecord = CardCycleWindowRecord & {
  id: string;
  workspaceId: string;
  accountId: string;
  materializedAt: Date;
};

export type MaterializeCardCyclePeriodInput = {
  workspaceId: string;
  accountId: string;
  window: CardCycleWindowRecord;
};

export type CardCycleBudgetRecord = {
  id: string;
  workspaceId: string;
  accountId: string;
  effectiveFrom: string;
  limitCents: number;
};

export type SaveCardCycleBudgetInput = {
  workspaceId: string;
  accountId: string;
  effectiveFrom: string;
  limitCents: number;
};

export type CardCycleSpendInput = {
  workspaceId: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
};

export abstract class CardCycleRepository {
  abstract materializePeriod(
    input: MaterializeCardCyclePeriodInput,
  ): Promise<CardCyclePeriodRecord>;

  abstract findPeriod(
    workspaceId: string,
    accountId: string,
    dueDate: string,
  ): Promise<CardCyclePeriodRecord | null>;

  abstract findApplicableBudget(
    workspaceId: string,
    accountId: string,
    dueDate: string,
  ): Promise<CardCycleBudgetRecord | null>;

  abstract saveBudget(
    input: SaveCardCycleBudgetInput,
  ): Promise<CardCycleBudgetRecord>;

  abstract listPeriods(
    workspaceId: string,
    accountId: string,
    limit: number,
  ): Promise<CardCyclePeriodRecord[]>;

  abstract sumCycleSpend(input: CardCycleSpendInput): Promise<number>;
}
