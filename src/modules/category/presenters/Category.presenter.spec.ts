import { TransactionType } from '@constants/enums';
import { Category } from '../entities/Category';
import { CategoryPresenter } from './Category.presenter';

function makeCategory(overrides = {}, id = 'cat-1'): Category {
  const result = Category.create(
    {
      workspaceId: 'workspace-1',
      name: 'Food',
      type: TransactionType.EXPENSE,
      parentId: null,
      isSystemCategory: false,
      ...overrides,
    },
    id,
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('CategoryPresenter', () => {
  it('should expose isHidden', () => {
    expect(CategoryPresenter.toHTTP(makeCategory({ isHidden: true }))).toEqual(
      expect.objectContaining({ isHidden: true }),
    );
  });

  it('should not expose workspaceId', () => {
    expect(CategoryPresenter.toHTTP(makeCategory())).not.toHaveProperty(
      'workspaceId',
    );
  });

  it('should carry isHidden on the parent and on each child', () => {
    const response = CategoryPresenter.toHTTPHierarchy(
      makeCategory({ isHidden: true }),
      [makeCategory({ name: 'Groceries', parentId: 'cat-1' }, 'cat-2')],
    );

    expect(response.isHidden).toBe(true);
    expect(response.children[0].isHidden).toBe(false);
    expect(response.children[0]).not.toHaveProperty('workspaceId');
  });
});
