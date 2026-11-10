import { TransactionType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { Category } from '@modules/category/entities/Category';
import {
  CategoryNameAlreadyExistsError,
  InvalidParentCategoryError,
} from '@modules/category/errors';
import { BusinessRuleDomainError } from '@shared/core/errors/DomainError';
import { CategoryRepositoryImplementation } from './category.repository';

function postgresError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function makeRepository(error: unknown): CategoryRepositoryImplementation {
  const returning = jest.fn().mockRejectedValue(error);
  const values = jest.fn().mockReturnValue({ returning });
  const insert = jest.fn().mockReturnValue({ values });
  const drizzle = { db: { insert } } as unknown as DrizzleService;

  return new CategoryRepositoryImplementation(drizzle);
}

function makeCategory(): Category {
  const result = Category.create(
    {
      workspaceId: 'ws-1',
      name: 'Mercado',
      type: TransactionType.EXPENSE,
      parentId: 'cat-parent',
      isSystemCategory: false,
    },
    'cat-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('CategoryRepositoryImplementation.create', () => {
  it.each([
    'categories_parent_id_categories_id_fk',
    'categories_parent_id_fkey',
  ])(
    'maps the %s violation to an invalid parent business rule error',
    async (constraint) => {
      const repository = makeRepository(
        postgresError(
          '23503',
          `insert or update on table "categories" violates foreign key constraint "${constraint}"`,
        ),
      );

      await expect(repository.create(makeCategory())).rejects.toBeInstanceOf(
        InvalidParentCategoryError,
      );
      await expect(repository.create(makeCategory())).rejects.toBeInstanceOf(
        BusinessRuleDomainError,
      );
    },
  );

  it('rethrows a foreign key violation from another constraint', async () => {
    const error = postgresError(
      '23503',
      'insert or update on table "categories" violates foreign key constraint "categories_workspace_id_workspaces_id_fk"',
    );

    await expect(makeRepository(error).create(makeCategory())).rejects.toBe(
      error,
    );
  });

  it('maps a unique violation to a name conflict error', async () => {
    const repository = makeRepository(
      postgresError(
        '23505',
        'duplicate key value violates unique constraint "unq_cat_ws_name_type_parent"',
      ),
    );

    await expect(repository.create(makeCategory())).rejects.toBeInstanceOf(
      CategoryNameAlreadyExistsError,
    );
  });
});
