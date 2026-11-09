import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import {
  BudgetSnapshotConflictError,
  ForbiddenBudgetCategoryError,
} from '@modules/budget/errors';
import { SaveBudgetSnapshotInput } from '@modules/budget/repositories/contracts/BudgetRepository';
import { BudgetRepositoryImplementation } from './budget.repository';

const INPUT: SaveBudgetSnapshotInput = {
  workspaceId: 'ws-1',
  effectiveFrom: new Date('2026-01-01T03:00:00.000Z'),
  monthlyIncome: 100_000,
  allocations: [
    {
      categoryId: 'cat-1',
      groupName: 'Geral',
      groupOrder: 0,
      categoryOrder: 0,
      percentageOfIncome: 100,
      targetCents: 100_000,
    },
  ],
};

function postgresError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function makeRepository(error: unknown): BudgetRepositoryImplementation {
  const transaction = jest.fn().mockRejectedValue(error);
  const drizzle = { db: { transaction } } as unknown as DrizzleService;

  return new BudgetRepositoryImplementation(drizzle);
}

describe('BudgetRepositoryImplementation.saveSnapshot', () => {
  it.each([
    'budget_allocations_category_id_categories_id_fk',
    'budget_allocations_category_id_fkey',
  ])(
    'maps the %s violation to a forbidden category error',
    async (constraint) => {
      const repository = makeRepository(
        postgresError(
          '23503',
          `insert or update on table "budget_allocations" violates foreign key constraint "${constraint}"`,
        ),
      );

      await expect(repository.saveSnapshot(INPUT)).rejects.toBeInstanceOf(
        ForbiddenBudgetCategoryError,
      );
    },
  );

  it('rethrows a foreign key violation from another constraint', async () => {
    const error = postgresError(
      '23503',
      'insert or update on table "budgets" violates foreign key constraint "budgets_workspace_id_workspaces_id_fk"',
    );

    await expect(makeRepository(error).saveSnapshot(INPUT)).rejects.toBe(error);
  });

  it('maps a unique violation to a snapshot conflict error', async () => {
    const repository = makeRepository(
      postgresError(
        '23505',
        'duplicate key value violates unique constraint "unq_budget_ws_effective_from"',
      ),
    );

    await expect(repository.saveSnapshot(INPUT)).rejects.toBeInstanceOf(
      BudgetSnapshotConflictError,
    );
  });
});
