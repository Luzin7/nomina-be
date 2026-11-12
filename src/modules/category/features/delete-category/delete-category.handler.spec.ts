import { TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Category } from '@modules/category/entities/Category';
import {
  CategoryInUseError,
  CategoryTargetNotFoundError,
  SystemCategoryModificationError,
} from '@modules/category/errors';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { NotFoundException } from '@nestjs/common';
import { DeleteCategoryService } from './delete-category.handler';

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
    findVisibleById: jest.fn(),
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

const NO_REFERENCES = {
  transactions: 0,
  allocations: 0,
  recurringRules: 0,
  children: 0,
};

describe('DeleteCategoryService', () => {
  let service: DeleteCategoryService;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let cacheProvider: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    categoryRepository = makeRepository();
    cacheProvider = makeCacheProvider();
    service = new DeleteCategoryService(categoryRepository, cacheProvider);
  });

  afterEach(() => jest.clearAllMocks());

  it('should delete a category nothing references', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(
      makeCategory({}, 'cat-1'),
    );
    categoryRepository.deleteIfUnreferenced.mockResolvedValue({
      deleted: true,
    });

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    expect(categoryRepository.deleteIfUnreferenced).toHaveBeenCalledWith(
      'cat-1',
      'ws-1',
    );
    expect(cacheProvider.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:category:ws-1',
      expect.any(Number),
    );
    expect(cacheProvider.delByPattern).not.toHaveBeenCalled();
  });

  it('should refuse a system category before any write', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(
      makeCategory({ workspaceId: null, isSystemCategory: true }, 'cat-system'),
    );

    const result = await service.execute(makeRequest({ id: 'cat-system' }));

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(SystemCategoryModificationError);
    }
    expect(categoryRepository.deleteIfUnreferenced).not.toHaveBeenCalled();
    expect(categoryRepository.delete).not.toHaveBeenCalled();
  });

  it('should return not found for a missing category', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft())
      expect(result.value).toBeInstanceOf(CategoryTargetNotFoundError);
    expect(() => ErrorPresenter.toHTTP(result.value as Error)).toThrow(
      NotFoundException,
    );
    expect(categoryRepository.deleteIfUnreferenced).not.toHaveBeenCalled();
  });

  it('should return not found for a category of another workspace', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(null);

    const result = await service.execute(makeRequest({ id: 'cat-foreign' }));

    expect(result.isLeft()).toBe(true);
    if (result.isLeft())
      expect(result.value).toBeInstanceOf(CategoryTargetNotFoundError);
    expect(categoryRepository.findVisibleById).toHaveBeenCalledWith(
      'cat-foreign',
      'ws-1',
    );
    expect(categoryRepository.deleteIfUnreferenced).not.toHaveBeenCalled();
  });

  it('should name transactions as the blocking reference', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(
      makeCategory({}, 'cat-1'),
    );
    categoryRepository.deleteIfUnreferenced.mockResolvedValue({
      deleted: false,
      references: { ...NO_REFERENCES, transactions: 2 },
    });

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(CategoryInUseError);
      expect(result.value.message).toContain('2 transações');
    }
    expect(cacheProvider.incrementCounter).not.toHaveBeenCalled();
  });

  it('should name budget allocations as the blocking reference', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(
      makeCategory({}, 'cat-1'),
    );
    categoryRepository.deleteIfUnreferenced.mockResolvedValue({
      deleted: false,
      references: { ...NO_REFERENCES, allocations: 1 },
    });

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(CategoryInUseError);
      expect(result.value.message).toContain('1 alocação de orçamento');
    }
  });

  it('should name recurring rules as the blocking reference', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(
      makeCategory({}, 'cat-1'),
    );
    categoryRepository.deleteIfUnreferenced.mockResolvedValue({
      deleted: false,
      references: { ...NO_REFERENCES, recurringRules: 1 },
    });

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(CategoryInUseError);
      expect(result.value.message).toContain('1 regra recorrente');
    }
  });

  it('should name children as the blocking reference', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(
      makeCategory({}, 'cat-1'),
    );
    categoryRepository.deleteIfUnreferenced.mockResolvedValue({
      deleted: false,
      references: { ...NO_REFERENCES, children: 3 },
    });

    const result = await service.execute(makeRequest());

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) {
      expect(result.value).toBeInstanceOf(CategoryInUseError);
      expect(result.value.message).toContain('3 subcategorias');
    }
  });

  it('should carry the reference counts on the error', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(
      makeCategory({}, 'cat-1'),
    );
    const references = { ...NO_REFERENCES, transactions: 1, children: 1 };
    categoryRepository.deleteIfUnreferenced.mockResolvedValue({
      deleted: false,
      references,
    });

    const result = await service.execute(makeRequest());

    if (result.isRight()) throw new Error('expected a conflict');
    expect((result.value as CategoryInUseError).references).toEqual(references);
  });

  it('should rethrow an unexpected repository failure', async () => {
    categoryRepository.findVisibleById.mockResolvedValue(
      makeCategory({}, 'cat-1'),
    );
    const failure = new Error('connection lost');
    categoryRepository.deleteIfUnreferenced.mockRejectedValue(failure);

    await expect(service.execute(makeRequest())).rejects.toBe(failure);
  });
});
