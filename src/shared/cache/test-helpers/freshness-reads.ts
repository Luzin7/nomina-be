import { ListAccountsService } from '@modules/account/features/list-accounts/list-accounts.service';
import { GetBudgetStatusService } from '@modules/budget/features/get-status/get-status.handler';
import { GetCardCycleStatusService } from '@modules/card-cycle/features/get-card-cycle-status/get-card-cycle-status.handler';
import { ListCategoriesService } from '@modules/category/features/list-categories/list-categories.handler';
import { GetAvailableToSpendService } from '@modules/dashboard/features/get-available-to-spend/get-available-to-spend.handler';
import { GetGoalsSummaryService } from '@modules/goal/features/get-goals-summary/get-goals-summary.service';
import { ListGoalContributionsService } from '@modules/goal/features/list-goal-contributions/list-goal-contributions.service';
import { ListGoalsService } from '@modules/goal/features/list-goals/list-goals.service';
import { BalanceEvolutionService } from '@modules/report/features/get-balance-evolution/get-balance-evolution.handler';
import { GetExpensesByCategoryService } from '@modules/report/features/get-expenses-by-category/get-expenses-by-category.handler';
import { FindMonthSummaryService } from '@modules/report/features/get-month-summary/get-month-summary.service';
import { GetProjectionService } from '@modules/report/features/get-projection/get-projection.handler';
import { ListRecurringTransactionsService } from '@modules/transaction/features/list-recurring-transactions/list-recurring-transactions.service';
import { ListTransactionsService } from '@modules/transaction/features/list-transaction/list-transaction.service';
import { ListRecurringSuggestionsService } from '@modules/transaction/features/recurring-suggestions/list-recurring-suggestions.service';
import { RecurringSummaryService } from '@modules/transaction/features/recurring-summary/recurring-summary.service';
import { FreshnessContext, FreshnessRead, unwrap } from './freshness-suite';

function actor({ seed }: FreshnessContext) {
  return { workspaceId: seed.workspaceId, sub: seed.userId };
}

const withoutKey = (
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

export const FRESHNESS_READS: FreshnessRead[] = [
  {
    name: 'month-summary',
    domains: ['ledger'],
    run: async (context) =>
      unwrap(
        await context.app
          .get(FindMonthSummaryService)
          .execute(actor(context) as never),
      ),
  },
  {
    name: 'balance-evolution',
    domains: ['ledger'],
    run: async (context) =>
      unwrap(
        await context.app
          .get(BalanceEvolutionService)
          .execute({ ...actor(context), period: '30d' } as never),
      ),
  },
  {
    name: 'expenses-by-category',
    domains: ['ledger', 'category'],
    run: async ({ app, seed }) =>
      app.get(GetExpensesByCategoryService).execute({
        workspaceId: seed.workspaceId,
        month: seed.month,
        year: seed.year,
      } as never),
  },
  {
    name: 'budget-status',
    domains: ['ledger', 'category'],
    run: async ({ app, seed }) =>
      unwrap(
        await app.get(GetBudgetStatusService).execute({
          ...actor({ seed } as FreshnessContext),
          month: seed.month,
          year: seed.year,
        }),
      ),
  },
  {
    name: 'available-to-spend',
    domains: ['ledger', 'goal', 'category'],
    run: async (context) =>
      unwrap(
        await context.app
          .get(GetAvailableToSpendService)
          .execute(actor(context)),
      ),
  },
  {
    name: 'projection',
    domains: ['ledger', 'goal'],
    run: async ({ app, seed }) => {
      const projection = unwrap<Record<string, unknown>>(
        await app
          .get(GetProjectionService)
          .execute({ workspaceId: seed.workspaceId, months: 3 }),
      );
      return withoutKey(projection, 'generatedAt');
    },
  },
  {
    name: 'goals-summary',
    domains: ['ledger', 'goal', 'category'],
    run: async ({ app, seed }) =>
      unwrap(
        await app
          .get(GetGoalsSummaryService)
          .execute({ workspaceId: seed.workspaceId }),
      ),
  },
  {
    name: 'list-goals',
    domains: ['ledger', 'goal', 'category'],
    run: async ({ app, seed }) => {
      const goals = unwrap<Record<string, unknown>>(
        await app
          .get(ListGoalsService)
          .execute({ workspaceId: seed.workspaceId }),
      );
      return withoutKey(goals, 'now');
    },
  },
  {
    name: 'goal-contributions',
    domains: ['goal', 'ledger'],
    run: async ({ app, seed }) => {
      const result = await app
        .get(ListGoalContributionsService)
        .execute({ workspaceId: seed.workspaceId, goalId: seed.goalId });

      return result.isLeft() ? { error: result.value.name } : result.value;
    },
  },
  {
    name: 'list-accounts',
    domains: ['ledger'],
    run: async ({ app, seed }) =>
      unwrap(
        await app
          .get(ListAccountsService)
          .execute({ workspaceId: seed.workspaceId, page: 1, pageSize: 20 }),
      ),
  },
  {
    name: 'card-cycle-status',
    domains: ['ledger'],
    run: async ({ app, seed }) =>
      unwrap(
        await app
          .get(GetCardCycleStatusService)
          .execute({ workspaceId: seed.workspaceId, accountId: seed.cardId }),
      ),
  },
  {
    name: 'list-transactions',
    domains: ['ledger', 'category'],
    run: async (context) =>
      unwrap(
        await context.app
          .get(ListTransactionsService)
          .execute({ ...actor(context), page: 1, pageSize: 20 } as never),
      ),
  },
  {
    name: 'list-recurring',
    domains: ['ledger', 'category'],
    run: async ({ app, seed }) =>
      unwrap(
        await app.get(ListRecurringTransactionsService).execute({
          workspaceId: seed.workspaceId,
          page: 1,
          pageSize: 20,
          activeOnly: false,
        } as never),
      ),
  },
  {
    name: 'recurring-summary',
    domains: ['ledger'],
    run: async ({ app, seed }) =>
      unwrap(
        await app
          .get(RecurringSummaryService)
          .execute({ workspaceId: seed.workspaceId }),
      ),
  },
  {
    name: 'list-suggestions',
    domains: ['ledger', 'category'],
    run: async ({ app, seed }) =>
      unwrap(
        await app
          .get(ListRecurringSuggestionsService)
          .execute({ workspaceId: seed.workspaceId }),
      ),
  },
  {
    name: 'list-categories',
    domains: ['category'],
    run: async ({ app, seed }) =>
      unwrap(
        await app.get(ListCategoriesService).execute({
          workspaceId: seed.workspaceId,
          page: 1,
          pageSize: 20,
          hidden: 'false',
        } as never),
      ),
  },
  {
    name: 'list-categories-hierarchy',
    domains: ['category'],
    run: async ({ app, seed }) =>
      unwrap(
        await app.get(ListCategoriesService).execute({
          workspaceId: seed.workspaceId,
          page: 1,
          pageSize: 20,
          hidden: 'all',
        } as never),
      ),
  },
];
