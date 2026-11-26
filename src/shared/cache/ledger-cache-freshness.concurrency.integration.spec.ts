import {
  AccountType,
  BUDGET_MODE_DEFAULT,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { CreateAccountService } from '@modules/account/features/create-account/create-account.service';
import { CreateGoalContributionService } from '@modules/goal/features/create-goal-contribution/create-goal-contribution.service';
import { DeleteAccountService } from '@modules/account/features/delete-account/delete-account.handler';
import { UpdateAccountService } from '@modules/account/features/update-account/update-account.service';
import { CreateRecurringTransactionService } from '@modules/transaction/features/create-recurring-transaction/create-recurring-transaction.service';
import { CreateTransactionService } from '@modules/transaction/features/create-transaction/create-transaction.service';
import { DeleteTransactionService } from '@modules/transaction/features/delete-transaction/delete-transaction.service';
import { SetTransactionStatusService } from '@modules/transaction/features/set-transaction-status/set-transaction-status.service';
import { UpdateTransactionService } from '@modules/transaction/features/update-transaction/update-transaction.service';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { AdjustAccountBalanceService } from '@modules/account/features/adjust-account-balance/adjust-account-balance.service';
import { SetAutopayService } from '@modules/account/features/set-autopay/set-autopay.service';
import { SaveBudgetConfigService } from '@modules/budget/features/save-config/save-config.handler';
import { SaveCardCycleBudgetService } from '@modules/card-cycle/features/save-card-cycle-budget/save-card-cycle-budget.handler';
import { UpdateCategoryService } from '@modules/category/features/update-category/update-category.handler';
import { CreateInstallmentPurchaseService } from '@modules/transaction/features/create-installment-purchase/create-installment-purchase.service';
import { DeleteRecurringTransactionService } from '@modules/transaction/features/delete-recurring-transaction/delete-recurring-transaction.service';
import { PayCreditCardInvoiceService } from '@modules/transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.service';
import { AcceptRecurringSuggestionService } from '@modules/transaction/features/recurring-suggestions/accept-recurring-suggestion.service';
import { MarkRecurringSuggestionsShownService } from '@modules/transaction/features/recurring-suggestions/mark-recurring-suggestions-shown.service';
import { DismissRecurringSuggestionService } from '@modules/transaction/features/recurring-suggestions/dismiss-recurring-suggestion.service';
import { ToggleActiveRecurringTransactionService } from '@modules/transaction/features/toggle-active-recurring-transaction/toggle-active-recurring-transaction.service';
import { UpdateRecurringTransactionService } from '@modules/transaction/features/update-recurring-transaction/update-recurring-transaction.service';
import { GenerateRecurringTransactionsJobService } from '@modules/transaction/jobs/generate-recurring-transactions/generate-recurring-transactions.service';
import { SettleCardInstallmentsJobService } from '@modules/transaction/jobs/settle-card-installments/settle-card-installments.service';
import * as schema from '@infra/databases/drizzle/schema';
import { GetExpensesByCategoryService } from '@modules/report/features/get-expenses-by-category/get-expenses-by-category.handler';
import { GetMonthPaceService } from '@modules/report/features/get-month-pace/get-month-pace.handler';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FRESHNESS_READS } from './test-helpers/freshness-reads';
import {
  ApplicationHandle,
  createApplication,
  PostgresHandle,
  startPostgres,
  startValkey,
  ValkeyHandle,
} from './test-helpers/freshness-harness';
import {
  AMOUNT,
  DAY_MS,
  defineFreshnessSuite,
  FreshnessContext,
  FreshnessSeed,
  seedWorkspace,
  snapshot,
  unwrap,
} from './test-helpers/freshness-suite';

const LEDGER_VISIBLE = [
  'month-summary',
  'balance-evolution',
  'expenses-by-category',
  'list-accounts',
  'list-transactions',
];

const LEDGER_ROWS_VISIBLE = [
  ...LEDGER_VISIBLE,
  'month-pace',
  'list-totals',
  'list-goals',
  'goals-summary',
];

function daysFromToday({ seed }: FreshnessContext, days: number): string {
  return new Date(Date.parse(seed.today) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function actor({ seed }: FreshnessContext) {
  return { workspaceId: seed.workspaceId, sub: seed.userId };
}

function expenseRequest({ seed }: FreshnessContext, amount: bigint) {
  return {
    ...actor({ seed } as FreshnessContext),
    accountId: seed.accountId,
    categoryId: seed.categoryId,
    title: 'Updated expense',
    amount,
    date: seed.today,
    type: TransactionType.EXPENSE,
    status: TransactionStatus.COMPLETED,
  };
}

defineFreshnessSuite({
  title: 'ledger read cache freshness',
  domain: 'ledger',
  reads: FRESHNESS_READS,
  writes: [
    {
      name: 'create-transaction',
      changes: LEDGER_ROWS_VISIBLE,
      run: async (context) => {
        unwrap(
          await context.app
            .get(CreateTransactionService)
            .execute(expenseRequest(context, AMOUNT * 3n) as never),
        );
      },
    },
    {
      name: 'update-transaction',
      changes: LEDGER_ROWS_VISIBLE,
      run: async (context) => {
        unwrap(
          await context.app.get(UpdateTransactionService).execute({
            ...expenseRequest(context, AMOUNT * 5n),
            transactionId: context.seed.transactionId,
          } as never),
        );
      },
    },
    {
      name: 'delete-transaction',
      changes: LEDGER_ROWS_VISIBLE,
      run: async (context) => {
        unwrap(
          await context.app.get(DeleteTransactionService).execute({
            ...actor(context),
            transactionId: context.seed.transactionId,
          } as never),
        );
      },
    },
    {
      name: 'set-transaction-status',
      changes: [...LEDGER_VISIBLE, 'month-pace'],
      run: async (context) => {
        unwrap(
          await context.app.get(SetTransactionStatusService).execute({
            ...actor(context),
            transactionId: context.seed.transactionId,
            status: TransactionStatus.PENDING,
          } as never),
        );
      },
    },
    {
      name: 'create-account',
      changes: ['list-accounts'],
      run: async (context) => {
        unwrap(
          await context.app.get(CreateAccountService).execute({
            ...actor(context),
            type: AccountType.CHECKING,
            name: 'Nova conta',
            balance: 0,
            timezone: 'UTC',
          } as never),
        );
      },
    },
    {
      name: 'update-account',
      changes: ['list-accounts'],
      run: async (context) => {
        unwrap(
          await context.app.get(UpdateAccountService).execute({
            workspaceId: context.seed.workspaceId,
            accountId: context.seed.otherAccountId,
            name: 'Conta renomeada',
          } as never),
        );
      },
    },
    {
      name: 'delete-account',
      changes: [
        'list-accounts',
        'list-goals',
        'goal-contributions',
        'expenses-by-category',
      ],
      prepare: async (context) => {
        unwrap(
          await context.app.get(CreateGoalContributionService).execute({
            workspaceId: context.seed.workspaceId,
            goalId: context.seed.goalId,
            id: randomUUID(),
            amountCents: 5_000,
            sourceAccountId: context.seed.otherAccountId,
          }),
        );
        unwrap(
          await context.app.get(CreateTransactionService).execute({
            workspaceId: context.seed.workspaceId,
            sub: context.seed.userId,
            accountId: context.seed.otherAccountId,
            categoryId: context.seed.categoryId,
            title: 'Deleted account expense',
            amount: AMOUNT,
            date: context.seed.today,
            type: TransactionType.EXPENSE,
            status: TransactionStatus.COMPLETED,
          } as never),
        );
      },
      run: async (context) => {
        unwrap(
          await context.app.get(DeleteAccountService).execute({
            workspaceId: context.seed.workspaceId,
            accountId: context.seed.otherAccountId,
          } as never),
        );
      },
    },
    {
      name: 'create-recurring-transaction',
      changes: ['recurring-summary', 'list-recurring'],
      run: async (context) => {
        unwrap(
          await context.app.get(CreateRecurringTransactionService).execute({
            ...actor(context),
            accountId: context.seed.accountId,
            categoryId: context.seed.categoryId,
            title: 'Aluguel',
            amount: AMOUNT,
            frequency: RecurrenceFrequency.MONTHLY,
            interval: 1,
            type: TransactionType.EXPENSE,
            startDate: daysFromToday(context, 2),
          } as never),
        );
      },
    },
    {
      name: 'create-installment-purchase',
      changes: ['list-transactions', 'list-totals'],
      run: async (context) => {
        unwrap(
          await context.app.get(CreateInstallmentPurchaseService).execute({
            ...actor(context),
            accountId: context.seed.cardId,
            categoryId: context.seed.categoryId,
            title: 'Notebook',
            totalAmount: AMOUNT * 3n,
            installments: 3,
            purchaseDate: context.seed.today,
            type: TransactionType.EXPENSE,
          } as never),
        );
      },
    },
    {
      name: 'update-recurring-transaction',
      changes: ['list-recurring'],
      run: async (context) => {
        unwrap(
          await context.app.get(UpdateRecurringTransactionService).execute({
            workspaceId: context.seed.workspaceId,
            recurringTransactionId: context.seed.recurringId,
            title: 'Assinatura renomeada',
            amount: AMOUNT * 2n,
          } as never),
        );
      },
    },
    {
      name: 'toggle-recurring-transaction',
      changes: ['list-recurring'],
      run: async (context) => {
        unwrap(
          await context.app
            .get(ToggleActiveRecurringTransactionService)
            .execute({
              workspaceId: context.seed.workspaceId,
              recurringTransactionId: context.seed.recurringId,
            } as never),
        );
      },
    },
    {
      name: 'delete-recurring-transaction',
      changes: ['list-recurring'],
      run: async (context) => {
        unwrap(
          await context.app.get(DeleteRecurringTransactionService).execute({
            workspaceId: context.seed.workspaceId,
            recurringTransactionId: context.seed.recurringId,
          } as never),
        );
      },
    },
    {
      name: 'accept-recurring-suggestion',
      changes: ['list-suggestions'],
      run: async (context) => {
        unwrap(
          await context.app.get(AcceptRecurringSuggestionService).execute({
            workspaceId: context.seed.workspaceId,
            suggestionId: context.seed.suggestionId,
          }),
        );
      },
    },
    {
      name: 'dismiss-recurring-suggestion',
      changes: ['list-suggestions'],
      run: async (context) => {
        unwrap(
          await context.app.get(DismissRecurringSuggestionService).execute({
            workspaceId: context.seed.workspaceId,
            suggestionId: context.seed.suggestionId,
          }),
        );
      },
    },
    {
      name: 'mark-recurring-suggestions-shown',
      changes: ['list-suggestions'],
      run: async (context) => {
        unwrap(
          await context.app.get(MarkRecurringSuggestionsShownService).execute({
            workspaceId: context.seed.workspaceId,
            ids: [context.seed.suggestionId],
          }),
        );
      },
    },
    {
      name: 'pay-credit-card-invoice',
      changes: ['list-accounts'],
      run: async (context) => {
        unwrap(
          await context.app.get(CreateTransactionService).execute({
            ...expenseRequest(context, AMOUNT),
            accountId: context.seed.cardId,
          } as never),
        );
        unwrap(
          await context.app.get(PayCreditCardInvoiceService).execute({
            ...actor(context),
            creditCardAccountId: context.seed.cardId,
            sourceAccountId: context.seed.accountId,
            amount: Number(AMOUNT),
          } as never),
        );
      },
    },
    {
      name: 'generate-recurring-transactions-job',
      changes: ['list-transactions', 'list-totals'],
      run: async ({ app, db, seed }) => {
        await db.insert(schema.recurringTransactions).values({
          workspaceId: seed.workspaceId,
          accountId: seed.accountId,
          categoryId: seed.categoryId,
          type: TransactionType.EXPENSE,
          title: 'Vencida',
          amount: Number(AMOUNT),
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 1,
          startDate: new Date(Date.parse(seed.today) - DAY_MS),
          active: true,
        });
        unwrap(
          await app.get(GenerateRecurringTransactionsJobService).execute(),
        );
      },
    },
    {
      name: 'settle-card-installments-job',
      changes: ['list-transactions', 'list-totals'],
      run: async ({ app, db, seed }) => {
        await db.insert(schema.transactions).values({
          workspaceId: seed.workspaceId,
          accountId: seed.cardId,
          categoryId: seed.categoryId,
          recurringId: seed.recurringId,
          title: 'Parcela',
          amount: Number(AMOUNT),
          date: new Date(Date.parse(seed.today) - DAY_MS),
          type: TransactionType.EXPENSE,
          status: TransactionStatus.PENDING,
        });
        await app.get(SettleCardInstallmentsJobService).execute();
      },
    },
    {
      name: 'adjust-account-balance',
      changes: ['list-accounts', 'projection'],
      run: async (context) => {
        const account = await context.app
          .get(AccountRepository)
          .findById(context.seed.accountId);
        const current = account?.balance ?? 0n;
        unwrap(
          await context.app.get(AdjustAccountBalanceService).execute({
            ...actor(context),
            id: randomUUID(),
            accountId: context.seed.accountId,
            expectedBalanceCents: Number(current),
            targetBalanceCents: Number(current + AMOUNT),
          } as never),
        );
      },
    },
    {
      name: 'set-autopay',
      changes: [],
      run: async (context) => {
        unwrap(
          await context.app.get(SetAutopayService).execute({
            workspaceId: context.seed.workspaceId,
            accountId: context.seed.cardId,
            enabled: true,
            sourceAccountId: context.seed.accountId,
          }),
        );
      },
    },
    {
      name: 'save-card-cycle-budget',
      changes: [],
      run: async (context) => {
        unwrap(
          await context.app.get(SaveCardCycleBudgetService).execute({
            workspaceId: context.seed.workspaceId,
            accountId: context.seed.cardId,
            effectiveFrom: daysFromToday(context, 45),
            limitCents: 50_000,
          }),
        );
      },
    },
    {
      name: 'save-budget-config',
      changes: ['budget-status', 'month-pace'],
      run: async (context) => {
        unwrap(
          await context.app.get(SaveBudgetConfigService).execute({
            workspaceId: context.seed.workspaceId,
            mode: BUDGET_MODE_DEFAULT,
            monthlyIncome: 500_000,
            effectiveFrom: context.seed.monthStart,
            allocations: [
              { categoryId: context.seed.categoryId, percentageOfIncome: 100 },
            ],
          }),
        );
      },
    },
    {
      name: 'update-category-hidden',
      changes: [],
      run: async (context) => {
        unwrap(
          await context.app.get(UpdateCategoryService).execute({
            id: context.seed.extraCategoryId,
            workspaceId: context.seed.workspaceId,
            isHidden: true,
          }),
        );
      },
    },
  ],
});

const EXPENSES_ROUTE = 'report:expenses-by-category';
const PACE_ROUTE = 'report:month-pace';
const MISS_PREFIX = 'read-through miss key=';

interface MonthAt {
  year: number;
  month: number;
  date: string;
}

function monthAt(seed: FreshnessSeed, offset: number): MonthAt {
  const reference = new Date(
    Date.UTC(seed.year, seed.month - 1 + offset, 15, 12),
  );
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth() + 1;

  return {
    year,
    month,
    date: reference.toISOString().slice(0, 10),
  };
}

function missedKeys(spy: jest.SpyInstance): string[] {
  return spy.mock.calls
    .map(([message]) => String(message))
    .filter((message) => message.startsWith(MISS_PREFIX))
    .map((message) => message.slice(MISS_PREFIX.length).split(' ')[0]);
}

function missesFor(
  spy: jest.SpyInstance,
  route: string,
  workspaceId: string,
): string[] {
  return missedKeys(spy).filter(
    (key) => key.startsWith(`${route}:`) && key.includes(`:${workspaceId}:`),
  );
}

describe('month scoped report generation', () => {
  let postgres: PostgresHandle;
  let valkey: ValkeyHandle;
  let app: ApplicationHandle;
  let log: jest.SpyInstance;

  beforeAll(async () => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    postgres = await startPostgres();
    valkey = await startValkey();
    app = await createApplication(postgres.db, valkey.cache);
  });

  afterAll(async () => {
    await app?.close();
    await valkey?.stop();
    await postgres?.stop();
    log.mockRestore();
  });

  beforeEach(() => log.mockClear());

  const readExpenses = async (workspaceId: string, at: MonthAt) =>
    app.get(GetExpensesByCategoryService).execute({
      workspaceId,
      year: at.year,
      month: at.month,
      limit: 5,
    });

  const readPace = async (workspaceId: string, at: MonthAt) =>
    unwrap(
      await app.get(GetMonthPaceService).execute({
        workspaceId,
        month: at.month,
        year: at.year,
      }),
    );

  const createExpense = async (seed: FreshnessSeed, date: string) =>
    unwrap<Transaction>(
      await app.get(CreateTransactionService).execute({
        workspaceId: seed.workspaceId,
        sub: seed.userId,
        accountId: seed.accountId,
        categoryId: seed.categoryId,
        title: 'Gasto do mês',
        amount: AMOUNT,
        date,
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
      }),
    );

  it('serves the previous month from the same cache entry after a write in the current month', async () => {
    const seed = await seedWorkspace(app, postgres.db);
    const previous = monthAt(seed, -1);

    await readExpenses(seed.workspaceId, previous);
    const warmKeys = missesFor(log, EXPENSES_ROUTE, seed.workspaceId);
    expect(warmKeys).toHaveLength(1);
    const [warmKey] = warmKeys;
    const warmPayload = await valkey.cache.get(warmKey);
    const warmValue = snapshot(await readExpenses(seed.workspaceId, previous));

    await createExpense(seed, seed.today);

    const afterWrite = snapshot(await readExpenses(seed.workspaceId, previous));

    expect(warmPayload).not.toBeNull();
    expect(afterWrite).toBe(warmValue);
    expect(missesFor(log, EXPENSES_ROUTE, seed.workspaceId)).toEqual([warmKey]);
    await expect(valkey.cache.get(warmKey)).resolves.toBe(warmPayload);
  });

  it('re-reads the old and the new month after a date move', async () => {
    const seed = await seedWorkspace(app, postgres.db);
    const current = monthAt(seed, -2);
    const next = monthAt(seed, -1);
    const expense = await createExpense(seed, current.date);

    await readExpenses(seed.workspaceId, current);
    const warmCurrent = snapshot(await readExpenses(seed.workspaceId, current));
    await readExpenses(seed.workspaceId, next);
    const warmNext = snapshot(await readExpenses(seed.workspaceId, next));

    expect(missesFor(log, EXPENSES_ROUTE, seed.workspaceId)).toHaveLength(2);

    unwrap(
      await app.get(UpdateTransactionService).execute({
        workspaceId: seed.workspaceId,
        sub: seed.userId,
        transactionId: expense.id,
        accountId: seed.accountId,
        categoryId: seed.categoryId,
        title: expense.title,
        amount: expense.amount,
        date: next.date,
        type: TransactionType.EXPENSE,
        status: TransactionStatus.COMPLETED,
      }),
    );

    const afterCurrent = snapshot(
      await readExpenses(seed.workspaceId, current),
    );
    const afterNext = snapshot(await readExpenses(seed.workspaceId, next));

    const afterUpdate = missesFor(log, EXPENSES_ROUTE, seed.workspaceId).slice(
      2,
    );
    expect(afterUpdate).toHaveLength(2);
    expect(new Set(afterUpdate).size).toBe(2);
    expect(afterCurrent).not.toBe(warmCurrent);
    expect(afterNext).not.toBe(warmNext);
  });

  it('serves an unrelated month from the same cache entry after a write in the current month', async () => {
    const seed = await seedWorkspace(app, postgres.db);
    const unrelated = monthAt(seed, -3);

    await readExpenses(seed.workspaceId, unrelated);
    const warmKeys = missesFor(log, EXPENSES_ROUTE, seed.workspaceId);
    expect(warmKeys).toHaveLength(1);
    const [warmKey] = warmKeys;
    const warmValue = snapshot(await readExpenses(seed.workspaceId, unrelated));

    await createExpense(seed, seed.today);

    const afterWrite = snapshot(
      await readExpenses(seed.workspaceId, unrelated),
    );

    expect(afterWrite).toBe(warmValue);
    expect(missesFor(log, EXPENSES_ROUTE, seed.workspaceId)).toEqual([warmKey]);
  });

  it('re-reads the month entries after the workspace time zone changes', async () => {
    const seed = await seedWorkspace(app, postgres.db);
    const current = monthAt(seed, 0);
    await createExpense(seed, current.date);

    const warm = snapshot(await readExpenses(seed.workspaceId, current));
    const warmKeys = missesFor(log, EXPENSES_ROUTE, seed.workspaceId);
    expect(warmKeys).toHaveLength(1);

    const workspace = await app
      .get(WorkspaceRepository)
      .findById(seed.workspaceId);
    if (!workspace) throw new Error('workspace missing');
    workspace.updateDetails(
      workspace.name,
      workspace.currency,
      'America/Manaus',
      workspace.cycle,
    );
    await app.get(WorkspaceRepository).update(workspace);
    await valkey.cache.del(`workspace:timezone:${seed.workspaceId}`);

    const afterService = new GetExpensesByCategoryService(
      app.get(TransactionRepository),
      new GetWorkspaceTimezoneService(
        app.get(WorkspaceRepository),
        valkey.cache,
      ),
      app.get(DateProvider),
      valkey.cache,
    );
    const afterChange = snapshot(
      await afterService.execute({
        workspaceId: seed.workspaceId,
        year: current.year,
        month: current.month,
        limit: 5,
      }),
    );
    const afterKeys = missesFor(log, EXPENSES_ROUTE, seed.workspaceId);

    expect(afterKeys).toHaveLength(2);
    expect(afterKeys[1]).not.toBe(afterKeys[0]);
    expect(afterChange).toBe(warm);
  });

  it('re-reads the global month-pace entry after a write in the current month', async () => {
    const seed = await seedWorkspace(app, postgres.db);
    const current = monthAt(seed, 0);

    const warm = snapshot(await readPace(seed.workspaceId, current));
    expect(snapshot(await readPace(seed.workspaceId, current))).toBe(warm);
    expect(missesFor(log, PACE_ROUTE, seed.workspaceId)).toHaveLength(1);

    await createExpense(seed, seed.today);

    const afterWrite = snapshot(await readPace(seed.workspaceId, current));

    expect(missesFor(log, PACE_ROUTE, seed.workspaceId)).toHaveLength(2);
    expect(afterWrite).not.toBe(warm);
  });
});
