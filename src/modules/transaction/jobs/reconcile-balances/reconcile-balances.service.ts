import {
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  BalanceLedgerUncoveredError,
  BalanceReconciliationDivergenceError,
} from '@modules/transaction/errors';
import { Injectable, Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { sql } from 'drizzle-orm';

export interface AccountReconciliationRow extends Record<string, unknown> {
  account_id: string;
  account_name: string;
  workspace_id: string;
  balance: string | number;
  effects: string | number;
  movements: string | number;
  has_opening: boolean;
}

export interface BalanceDivergence {
  accountId: string;
  accountName: string;
  workspaceId: string;
  balance: number;
  effects: number;
  movements: number;
  unexplained: number;
}

export interface ReconcileBalancesSummary {
  accountsChecked: number;
  uncovered: number;
  divergences: BalanceDivergence[];
}

const MAX_UNCOVERED_ACCOUNT_IDS = 20;

function toBigInt(value: string | number): bigint {
  return BigInt(value);
}

function toDivergence(row: AccountReconciliationRow): BalanceDivergence {
  const balance = toBigInt(row.balance);
  const effects = toBigInt(row.effects);
  const movements = toBigInt(row.movements);

  return {
    accountId: row.account_id,
    accountName: row.account_name,
    workspaceId: row.workspace_id,
    balance: Number(balance),
    effects: Number(effects),
    movements: Number(movements),
    unexplained: Number(balance - effects - movements),
  };
}

@Injectable()
export class ReconcileBalancesJobService {
  private readonly logger = new Logger(ReconcileBalancesJobService.name);

  constructor(private readonly database: DrizzleService) {}

  async execute(): Promise<ReconcileBalancesSummary> {
    const rows = await this.readAccounts();

    const uncoveredRows = rows.filter((row) => !row.has_opening);
    const divergences = rows
      .filter((row) => row.has_opening)
      .map(toDivergence)
      .filter((divergence) => divergence.unexplained !== 0)
      .sort((left, right) => left.unexplained - right.unexplained);

    if (divergences.length > 0) {
      this.logger.error(
        `Balance reconciliation found ${divergences.length} diverged account(s).`,
      );
      captureException(new BalanceReconciliationDivergenceError(divergences), {
        extra: { divergences },
      });
    }

    if (uncoveredRows.length > 0) {
      const accountIds = uncoveredRows
        .slice(0, MAX_UNCOVERED_ACCOUNT_IDS)
        .map((row) => row.account_id);

      this.logger.error(
        `Balance reconciliation could not cover ${uncoveredRows.length} account(s) without an opening movement.`,
      );
      captureException(
        new BalanceLedgerUncoveredError(uncoveredRows.length, accountIds),
        { extra: { uncovered: uncoveredRows.length, accountIds } },
      );
    }

    return {
      accountsChecked: rows.length,
      uncovered: uncoveredRows.length,
      divergences,
    };
  }

  private async readAccounts(): Promise<AccountReconciliationRow[]> {
    return this.database.db.transaction(
      async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);

        return tx.execute<AccountReconciliationRow>(sql`
          WITH effects AS (
            SELECT t.account_id AS account_id, CASE t.type
                WHEN ${TransactionType.INCOME} THEN t.amount
                WHEN ${TransactionType.EXPENSE} THEN -t.amount
                WHEN ${TransactionType.TRANSFER} THEN -t.amount
                ELSE 0::bigint
              END AS delta
            FROM transactions t
            WHERE t.status = ${TransactionStatus.COMPLETED}
            UNION ALL
            SELECT t.destination_account_id AS account_id, t.amount AS delta
            FROM transactions t
            WHERE t.status = ${TransactionStatus.COMPLETED}
              AND t.type = ${TransactionType.TRANSFER}
              AND t.destination_account_id IS NOT NULL
          ),
          effect_totals AS (
            SELECT account_id, SUM(delta)::bigint AS effects
            FROM effects
            GROUP BY account_id
          ),
          movement_totals AS (
            SELECT account_id, SUM(delta)::bigint AS movements
            FROM balance_movements
            GROUP BY account_id
          ),
          openings AS (
            SELECT DISTINCT account_id
            FROM balance_movements
            WHERE cause = ${BalanceMovementCause.OPENING}
          )
          SELECT a.id AS account_id,
                 a.name AS account_name,
                 a.workspace_id,
                 a.balance::bigint AS balance,
                 COALESCE(e.effects, 0)::bigint AS effects,
                 COALESCE(m.movements, 0)::bigint AS movements,
                 (o.account_id IS NOT NULL) AS has_opening
          FROM accounts a
          LEFT JOIN effect_totals e ON e.account_id = a.id
          LEFT JOIN movement_totals m ON m.account_id = a.id
          LEFT JOIN openings o ON o.account_id = a.id
          ORDER BY a.id
        `);
      },
      { accessMode: 'read only' },
    );
  }
}
