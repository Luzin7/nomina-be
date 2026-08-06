import { TransactionType } from '@constants/enums';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { ListCategoriesService } from './list-categories.handler';

function makeRequest(overrides = {}) {
  return { workspaceId: 'ws-1', page: 1, pageSize: 10, ...overrides };
}

function makeCategory(): Category {
  const result = Category.create({
    workspaceId: 'ws-1',
    name: 'Food',
    type: TransactionType.EXPENSE,
    parentId: null,
    isSystemCategory: false,
  });
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('ListCategoriesService', () => {
  let service: ListCategoriesService;
  let categoryRepository: jest.Mocked<CategoryRepository>;

  beforeEach(() => {
    categoryRepository = {
      findManyByWorkspaceId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      countByWorkspaceId: jest.fn(),
      findUniqueByAttributes: jest.fn(),
      countChildren: jest.fn(),
      countTransactions: jest.fn(),
      reassignChildren: jest.fn(),
      findManyByIds: jest.fn(),
      findSystemCategoryByName: jest.fn(),
    } as jest.Mocked<CategoryRepository>;

    service = new ListCategoriesService(categoryRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return categories and total', async () => {
    const categories = [makeCategory(), makeCategory()];
    categoryRepository.findManyByWorkspaceId.mockResolvedValue({
      categories,
      total: 2,
    });

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.categories).toHaveLength(2);
      expect(result.value.total).toBe(2);
    }
    expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
      'ws-1',
      { type: undefined },
      1,
      10,
    );
  });

  it('should return empty list when no categories exist', async () => {
    categoryRepository.findManyByWorkspaceId.mockResolvedValue({
      categories: [],
      total: 0,
    });

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.total).toBe(0);
  });
});
