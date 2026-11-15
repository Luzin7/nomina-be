import { TransactionType } from '@constants/enums';
import { CreateCategoryService } from '@modules/category/features/create-category/create-category.handler';
import { DeleteCategoryService } from '@modules/category/features/delete-category/delete-category.handler';
import { UpdateCategoryService } from '@modules/category/features/update-category/update-category.handler';
import { FRESHNESS_READS } from './test-helpers/freshness-reads';
import { defineFreshnessSuite, unwrap } from './test-helpers/freshness-suite';

defineFreshnessSuite({
  title: 'category read cache freshness',
  domain: 'category',
  reads: FRESHNESS_READS,
  writes: [
    {
      name: 'create-category',
      changes: ['list-categories', 'list-categories-hierarchy'],
      run: async ({ app, seed }) => {
        unwrap(
          await app.get(CreateCategoryService).execute({
            workspaceId: seed.workspaceId,
            name: 'Transporte',
            type: TransactionType.EXPENSE,
            parentId: null,
          }),
        );
      },
    },
    {
      name: 'update-category-name',
      changes: [
        'list-categories',
        'list-categories-hierarchy',
        'list-suggestions',
        'available-to-spend',
      ],
      run: async ({ app, seed }) => {
        unwrap(
          await app.get(UpdateCategoryService).execute({
            id: seed.categoryId,
            workspaceId: seed.workspaceId,
            name: 'Supermercado',
          }),
        );
      },
    },
    {
      name: 'update-category-hidden',
      changes: ['list-categories'],
      run: async ({ app, seed }) => {
        unwrap(
          await app.get(UpdateCategoryService).execute({
            id: seed.extraCategoryId,
            workspaceId: seed.workspaceId,
            isHidden: true,
          }),
        );
      },
    },
    {
      name: 'delete-category',
      changes: ['list-categories', 'list-categories-hierarchy', 'list-goals'],
      run: async ({ app, seed }) => {
        unwrap(
          await app.get(DeleteCategoryService).execute({
            id: seed.extraCategoryId,
            workspaceId: seed.workspaceId,
          }),
        );
      },
    },
  ],
});
