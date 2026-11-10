import { TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Category } from '@modules/category/entities/Category';
import {
  CategoryNameAlreadyExistsError,
  InvalidCategoryNameError,
  InvalidParentCategoryError,
} from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { CreateCategoryPipe } from './create-category.dto';
import { CreateCategoryService } from './create-category.handler';

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
  return {
    workspaceId: 'ws-1',
    name: 'Mercado',
    type: TransactionType.EXPENSE,
    ...overrides,
  };
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
    incrementCounter: jest.fn(),
  } as unknown as jest.Mocked<CacheProvider>;
}

describe('CreateCategoryService', () => {
  let service: CreateCategoryService;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let cacheProvider: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    categoryRepository = makeRepository();
    cacheProvider = makeCacheProvider();
    service = new CreateCategoryService(categoryRepository, cacheProvider);
  });

  afterEach(() => jest.clearAllMocks());

  it('should write the category with the workspace from the token', async () => {
    categoryRepository.create.mockImplementation(async (category) => category);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    const persisted = categoryRepository.create.mock.calls[0][0];
    expect(persisted.workspaceId).toBe('ws-1');
    expect(persisted.type).toBe(TransactionType.EXPENSE);
    expect(persisted.parentId).toBeNull();
    expect(persisted.isSystemCategory).toBe(false);
  });

  it('should drop a workspaceId sent in the body', () => {
    const parsed = CreateCategoryPipe.transform({
      name: 'Mercado',
      type: TransactionType.EXPENSE,
      workspaceId: 'ws-2',
    });

    expect(parsed).not.toHaveProperty('workspaceId');
  });

  it('should let the unique index decide the duplicate without a pre-check', async () => {
    categoryRepository.create.mockRejectedValue(
      new CategoryNameAlreadyExistsError(),
    );

    const result = await service.execute(makeRequest({ name: 'Lazer' }));

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(CategoryNameAlreadyExistsError);
    }
    expect(categoryRepository.create).toHaveBeenCalledTimes(1);
    expect(categoryRepository.findUniqueByAttributes).not.toHaveBeenCalled();
  });

  it('should allow a workspace category to share its name with a system one', async () => {
    categoryRepository.create.mockImplementation(async (category) => category);

    const result = await service.execute(makeRequest({ name: 'Alimentação' }));

    expect(result.isRight()).toBe(true);
    expect(categoryRepository.findUniqueByAttributes).not.toHaveBeenCalled();
  });

  it('should reject a parent that does not exist', async () => {
    categoryRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest({ parentId: 'missing' }));

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidParentCategoryError);
    }
    expect(categoryRepository.create).not.toHaveBeenCalled();
  });

  it('should reject a parent from another workspace', async () => {
    categoryRepository.findById.mockResolvedValue(
      makeCategory({ workspaceId: 'ws-2' }, 'cat-foreign'),
    );

    const result = await service.execute(
      makeRequest({ parentId: 'cat-foreign' }),
    );

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidParentCategoryError);
    }
    expect(categoryRepository.create).not.toHaveBeenCalled();
  });

  it('should accept a system category as parent', async () => {
    categoryRepository.findById.mockResolvedValue(
      makeCategory(
        { workspaceId: null, isSystemCategory: true, name: 'Alimentação' },
        'cat-system',
      ),
    );
    categoryRepository.create.mockImplementation(async (category) => category);

    const result = await service.execute(
      makeRequest({ parentId: 'cat-system' }),
    );

    expect(result.isRight()).toBe(true);
    expect(categoryRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should reject a parent that is not a root', async () => {
    categoryRepository.findById.mockResolvedValue(
      makeCategory({ parentId: 'cat-root' }, 'cat-child'),
    );

    const result = await service.execute(
      makeRequest({ parentId: 'cat-child' }),
    );

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidParentCategoryError);
    }
    expect(categoryRepository.create).not.toHaveBeenCalled();
  });

  it('should reject a parent of another type', async () => {
    categoryRepository.findById.mockResolvedValue(
      makeCategory({ type: TransactionType.INCOME }, 'cat-income'),
    );

    const result = await service.execute(
      makeRequest({ parentId: 'cat-income' }),
    );

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidParentCategoryError);
    }
    expect(categoryRepository.create).not.toHaveBeenCalled();
  });

  it('should reject an empty name before writing', async () => {
    const result = await service.execute(makeRequest({ name: '   ' }));

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(InvalidCategoryNameError);
    }
    expect(categoryRepository.create).not.toHaveBeenCalled();
  });

  it('should invalidate the category list after the write', async () => {
    categoryRepository.create.mockImplementation(async (category) => category);

    await service.execute(makeRequest());

    expect(cacheProvider.delByPattern).toHaveBeenCalledWith(
      'categories:list:ws-1:*',
    );
  });

  it('should keep the cache when the write fails', async () => {
    categoryRepository.create.mockRejectedValue(
      new CategoryNameAlreadyExistsError(),
    );

    await service.execute(makeRequest());

    expect(cacheProvider.delByPattern).not.toHaveBeenCalled();
  });

  it('should rethrow an unexpected repository failure', async () => {
    const failure = new Error('connection lost');
    categoryRepository.create.mockRejectedValue(failure);

    await expect(service.execute(makeRequest())).rejects.toBe(failure);
  });
});
