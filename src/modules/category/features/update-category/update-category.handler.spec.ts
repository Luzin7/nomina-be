import { TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Category } from '@modules/category/entities/Category';
import {
  CategoryNameAlreadyExistsError,
  CategoryTargetNotFoundError,
  EmptyCategoryUpdateError,
  InvalidCategoryNameError,
  SystemCategoryModificationError,
} from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { UpdateCategoryPipe } from './update-category.dto';
import { UpdateCategoryService } from './update-category.handler';

function makeCategory(
  overrides: Partial<{
    workspaceId: string | null;
    name: string;
    type: TransactionType;
    parentId: string | null;
    isSystemCategory: boolean;
    isHidden: boolean;
  }> = {},
  id = 'cat-1',
): Category {
  const result = Category.create(
    {
      workspaceId: 'ws-1',
      name: 'Mercado',
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

function makeRequest(overrides = {}) {
  return { workspaceId: 'ws-1', id: 'cat-1', ...overrides };
}

function makeRepository(): jest.Mocked<CategoryRepository> {
  return {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findById: jest.fn(),
    countByWorkspaceId: jest.fn(),
    findUniqueByAttributes: jest.fn(),
    findManyByWorkspaceId: jest.fn(),
    countChildren: jest.fn(),
    countTransactions: jest.fn(),
    countBudgetAllocations: jest.fn(),
    countRecurringTransactions: jest.fn(),
    deleteIfUnreferenced: jest.fn(),
    reassignChildren: jest.fn(),
    findManyByIds: jest.fn(),
  } as jest.Mocked<CategoryRepository>;
}

function makeCacheProvider(): jest.Mocked<CacheProvider> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delByPattern: jest.fn(),
    exists: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
    readCounter: jest.fn(),
    incrementCounter: jest.fn().mockResolvedValue(1),
  } as unknown as jest.Mocked<CacheProvider>;
}

describe('UpdateCategoryService', () => {
  let service: UpdateCategoryService;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let cacheProvider: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    categoryRepository = makeRepository();
    cacheProvider = makeCacheProvider();
    categoryRepository.update.mockImplementation(async (category) => category);
    service = new UpdateCategoryService(categoryRepository, cacheProvider);
  });

  afterEach(() => jest.clearAllMocks());

  it('should reject an empty body without touching the database', async () => {
    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(EmptyCategoryUpdateError);
    }
    expect(categoryRepository.findById).not.toHaveBeenCalled();
  });

  it('should rename a workspace category', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory({}, 'cat-1'));

    const result = await service.execute(makeRequest({ name: 'Feira' }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.name).toBe('Feira');
  });

  it('should keep type, parentId and workspaceId on rename', async () => {
    categoryRepository.findById.mockResolvedValue(
      makeCategory({ parentId: 'cat-root', workspaceId: 'ws-1' }, 'cat-1'),
    );

    await service.execute(makeRequest({ name: 'Feira' }));

    const persisted = categoryRepository.update.mock.calls[0][0];
    expect(persisted.type).toBe(TransactionType.EXPENSE);
    expect(persisted.parentId).toBe('cat-root');
    expect(persisted.workspaceId).toBe('ws-1');
  });

  it('should never accept type, parentId or workspaceId from the body', () => {
    const parsed = UpdateCategoryPipe.transform({
      name: 'Feira',
      type: TransactionType.INCOME,
      parentId: 'cat-root',
      workspaceId: 'ws-2',
    });

    expect(parsed).toEqual({ name: 'Feira' });
  });

  it('should refuse to rename a system category and change nothing', async () => {
    const systemCategory = makeCategory(
      { workspaceId: null, isSystemCategory: true, name: 'Alimentação' },
      'cat-system',
    );
    categoryRepository.findById.mockResolvedValue(systemCategory);

    const result = await service.execute(
      makeRequest({ id: 'cat-system', name: 'Outra' }),
    );

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(SystemCategoryModificationError);
    }
    expect(systemCategory.name).toBe('Alimentação');
    expect(categoryRepository.update).not.toHaveBeenCalled();
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('should refuse to hide a system category and change nothing', async () => {
    const systemCategory = makeCategory(
      { workspaceId: null, isSystemCategory: true },
      'cat-system',
    );
    categoryRepository.findById.mockResolvedValue(systemCategory);

    const result = await service.execute(
      makeRequest({ id: 'cat-system', isHidden: true }),
    );

    expect(result.isLeft()).toBe(true);
    expect(systemCategory.isHidden).toBe(false);
    expect(categoryRepository.update).not.toHaveBeenCalled();
  });

  it('should return not found for a missing category', async () => {
    categoryRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest({ name: 'Feira' }));

    expect(result.isLeft()).toBe(true);
    if (result.isLeft())
      expect(result.value).toBeInstanceOf(CategoryTargetNotFoundError);
    expect(categoryRepository.update).not.toHaveBeenCalled();
  });

  it('should return not found for a category of another workspace', async () => {
    categoryRepository.findById.mockResolvedValue(
      makeCategory({ workspaceId: 'ws-2' }, 'cat-foreign'),
    );

    const result = await service.execute(
      makeRequest({ id: 'cat-foreign', name: 'Feira' }),
    );

    expect(result.isLeft()).toBe(true);
    if (result.isLeft())
      expect(result.value).toBeInstanceOf(CategoryTargetNotFoundError);
    expect(categoryRepository.update).not.toHaveBeenCalled();
  });

  it('should keep hiding idempotent', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory({}, 'cat-1'));

    const first = await service.execute(makeRequest({ isHidden: true }));
    categoryRepository.findById.mockResolvedValue(
      makeCategory({ isHidden: true }, 'cat-1'),
    );
    const second = await service.execute(makeRequest({ isHidden: true }));

    expect(first.isRight()).toBe(true);
    expect(second.isRight()).toBe(true);
    expect(categoryRepository.update).toHaveBeenCalledTimes(2);
    expect(
      categoryRepository.update.mock.calls.map(
        ([category]) => category.isHidden,
      ),
    ).toEqual([true, true]);
  });

  it('should map a duplicate name to a conflict', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory({}, 'cat-1'));
    categoryRepository.update.mockRejectedValue(
      new CategoryNameAlreadyExistsError(),
    );

    const result = await service.execute(makeRequest({ name: 'Feira' }));

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(CategoryNameAlreadyExistsError);
    }
  });

  it('should reject a blank name before writing', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory({}, 'cat-1'));

    const result = await service.execute(makeRequest({ name: '   ' }));

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidCategoryNameError);
    }
    expect(categoryRepository.update).not.toHaveBeenCalled();
  });

  it('should invalidate the category list after the write', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory({}, 'cat-1'));

    await service.execute(makeRequest({ isHidden: true }));

    expect(cacheProvider.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:category:ws-1',
      expect.any(Number),
    );
    expect(cacheProvider.delByPattern).not.toHaveBeenCalled();
  });

  it('should bump the report generation when the patch hides a category', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory({}, 'cat-1'));

    await service.execute(makeRequest({ isHidden: true }));

    expect(cacheProvider.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:report:ws-1',
      expect.any(Number),
    );
  });

  it('should keep the report generation on a name-only patch', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory({}, 'cat-1'));

    await service.execute(makeRequest({ name: 'Feira' }));

    expect(cacheProvider.incrementCounter).not.toHaveBeenCalledWith(
      'cache-gen:report:ws-1',
      expect.any(Number),
    );
  });

  it('should rethrow an unexpected repository failure', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory({}, 'cat-1'));
    const failure = new Error('connection lost');
    categoryRepository.update.mockRejectedValue(failure);

    await expect(service.execute(makeRequest({ name: 'Feira' }))).rejects.toBe(
      failure,
    );
  });
});
