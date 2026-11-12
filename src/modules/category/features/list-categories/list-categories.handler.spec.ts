import { TransactionType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { ListCategoriesRequest } from './list-categories.dto';
import { ListCategoriesService } from './list-categories.handler';

function makeRequest(
  overrides: Partial<
    Pick<ListCategoriesRequest, 'hidden' | 'parentId' | 'type'>
  > = {},
) {
  return {
    workspaceId: 'ws-1',
    page: 1,
    pageSize: 10,
    hidden: 'false' as const,
    ...overrides,
  };
}

function makeCategory(
  overrides: Partial<{
    workspaceId: string | null;
    name: string;
    type: TransactionType;
    parentId: string | null;
    isSystemCategory: boolean;
    isHidden: boolean;
  }> = {},
  id?: string,
): Category {
  const result = Category.create(
    {
      workspaceId: 'ws-1',
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

function makeRedisService(): jest.Mocked<CacheProvider> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    delByPattern: jest.fn().mockResolvedValue(0),
    exists: jest.fn().mockResolvedValue(false),
    ping: jest.fn().mockResolvedValue(true),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true),
    getClient: jest.fn(),
    isAvailable: jest.fn().mockReturnValue(true),
    onModuleDestroy: jest.fn(),
    readCounter: jest.fn().mockResolvedValue(1),
    incrementCounter: jest.fn().mockResolvedValue(2),
  } as unknown as jest.Mocked<CacheProvider>;
}

describe('ListCategoriesService', () => {
  let service: ListCategoriesService;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let redisService: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    categoryRepository = {
      findManyByWorkspaceId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      findVisibleById: jest.fn(),
      countByWorkspaceId: jest.fn(),
      findUniqueByAttributes: jest.fn(),
      countChildren: jest.fn(),
      countTransactions: jest.fn(),
      reassignChildren: jest.fn(),
      findManyByIds: jest.fn(),
      countBudgetAllocations: jest.fn(),
      countRecurringTransactions: jest.fn(),
      deleteIfUnreferenced: jest.fn(),
    } as jest.Mocked<CategoryRepository>;

    redisService = makeRedisService();

    service = new ListCategoriesService(categoryRepository, redisService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('cache behavior', () => {
    it('should call repository on cache miss', async () => {
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      await service.execute(makeRequest());

      expect(redisService.get).toHaveBeenCalledTimes(1);
      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledTimes(1);
    });

    it('should store result in cache after fetch', async () => {
      const parent = makeCategory({ name: 'Alimentação' }, 'cat-p');
      const child = makeCategory(
        { parentId: parent.id, name: 'Mercado' },
        'cat-c',
      );

      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [parent, child],
        total: 2,
        usageCounts: {},
      });

      await service.execute(makeRequest());

      expect(redisService.set).toHaveBeenCalledTimes(1);
      const [key, payload, ttl] = redisService.set.mock.calls[0];
      expect(key).toContain('categories:list:ws-1');
      expect(ttl).toBe(6 * 60 * 60);
      expect(typeof payload).toBe('string');
    });

    it('should not serve an entry written under the previous generation', async () => {
      const stale = JSON.stringify({
        categories: [],
        total: 0,
        hierarchy: null,
      });
      redisService.readCounter.mockResolvedValue(7);
      redisService.get.mockImplementation(async (key) =>
        key.includes(':g7:') ? null : stale,
      );
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      await service.execute(makeRequest());

      expect(redisService.get).toHaveBeenCalledTimes(1);
      expect(redisService.get).toHaveBeenCalledWith(
        'categories:list:ws-1:g7:t=:p=none:h=false:1:10',
      );
      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledTimes(1);
      expect(redisService.set).toHaveBeenCalledWith(
        'categories:list:ws-1:g7:t=:p=none:h=false:1:10',
        expect.any(String),
        6 * 60 * 60,
      );
    });

    it('should skip the cache when the generation is unreadable', async () => {
      redisService.readCounter.mockResolvedValue(null);
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      await service.execute(makeRequest());

      expect(redisService.get).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledTimes(1);
    });

    it('should return cached data on cache hit without calling repository', async () => {
      const parent = makeCategory({ name: 'Alimentação' }, 'cat-p');
      const child = makeCategory(
        { parentId: parent.id, name: 'Mercado' },
        'cat-c',
      );

      const cachePayload = JSON.stringify({
        categories: [
          {
            id: parent.id,
            workspaceId: 'ws-1',
            name: 'Alimentação',
            type: 'EXPENSE',
            parentId: null,
            isSystemCategory: false,
          },
        ],
        total: 1,
        hierarchy: {
          [parent.id]: [
            {
              id: child.id,
              workspaceId: 'ws-1',
              name: 'Mercado',
              type: 'EXPENSE',
              parentId: parent.id,
              isSystemCategory: false,
            },
          ],
        },
      });

      redisService.get.mockResolvedValue(cachePayload);

      const result = await service.execute(makeRequest());

      expect(categoryRepository.findManyByWorkspaceId).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories).toHaveLength(1);
        expect(result.value.categories[0].name).toBe('Alimentação');
        expect(result.value.hierarchy).toBeDefined();
        expect(result.value.hierarchy![parent.id]).toHaveLength(1);
        expect(result.value.hierarchy![parent.id][0].name).toBe('Mercado');
      }
    });
  });

  describe('hierarchy mode (no parentId)', () => {
    it('should return parents with hierarchy map', async () => {
      const parent = makeCategory({ name: 'Alimentação' }, 'cat-parent-1');
      const child1 = makeCategory(
        { parentId: parent.id, name: 'Mercado' },
        'cat-child-1',
      );
      const child2 = makeCategory(
        { parentId: parent.id, name: 'Restaurante' },
        'cat-child-2',
      );
      const orphan = makeCategory({ name: 'Orphan' }, 'cat-orphan');

      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [parent, child1, child2, orphan],
        total: 4,
        usageCounts: {},
      });

      const result = await service.execute(makeRequest());

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories).toHaveLength(2);
        expect(result.value.total).toBe(2);
        expect(result.value.hierarchy).toBeDefined();
        expect(result.value.hierarchy![parent.id]).toHaveLength(2);
        expect(result.value.hierarchy![parent.id][0].id).toBe(child1.id);
        expect(result.value.hierarchy![parent.id][1].id).toBe(child2.id);
      }
    });

    it('should return empty when no categories exist', async () => {
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      const result = await service.execute(makeRequest());

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories).toHaveLength(0);
        expect(result.value.total).toBe(0);
        expect(result.value.hierarchy).toEqual({});
      }
    });

    it('should call repository without page/limit', async () => {
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      await service.execute(makeRequest());

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        { type: undefined, visibility: 'visible' },
      );
    });

    it('should sort children by usage DESC and name ASC', async () => {
      const parent = makeCategory({ name: 'Transporte' }, 'cat-parent');
      const childHigh = makeCategory(
        { parentId: parent.id, name: 'Uber' },
        'cat-high',
      );
      const childLow = makeCategory(
        { parentId: parent.id, name: 'Ônibus' },
        'cat-low',
      );
      const childMid = makeCategory(
        { parentId: parent.id, name: 'Metrô' },
        'cat-mid',
      );

      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [parent, childHigh, childLow, childMid],
        total: 4,
        usageCounts: {
          [childHigh.id]: 10,
          [childMid.id]: 5,
          [childLow.id]: 1,
        },
      });

      const result = await service.execute(makeRequest());

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        const children = result.value.hierarchy![parent.id];
        expect(children[0].id).toBe(childHigh.id);
        expect(children[1].id).toBe(childMid.id);
        expect(children[2].id).toBe(childLow.id);
      }
    });

    it('should sort parents by aggregate child usage DESC', async () => {
      const parentA = makeCategory({ name: 'Alimentação' }, 'cat-a');
      const parentB = makeCategory({ name: 'Transporte' }, 'cat-b');
      const childA1 = makeCategory(
        { parentId: parentA.id, name: 'Mercado' },
        'cat-a1',
      );
      const childA2 = makeCategory(
        { parentId: parentA.id, name: 'Restaurante' },
        'cat-a2',
      );
      const childB1 = makeCategory(
        { parentId: parentB.id, name: 'Combustível' },
        'cat-b1',
      );

      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [parentA, parentB, childA1, childA2, childB1],
        total: 5,
        usageCounts: {
          [childA1.id]: 3,
          [childA2.id]: 7,
          [childB1.id]: 20,
        },
      });

      const result = await service.execute(makeRequest());

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories[0].id).toBe(parentB.id);
        expect(result.value.categories[1].id).toBe(parentA.id);
      }
    });

    it('should sort parents alphabetically when no children have usage', async () => {
      const parentA = makeCategory({ name: 'Alimentação' }, 'cat-a');
      const parentB = makeCategory({ name: 'Transporte' }, 'cat-b');

      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [parentA, parentB],
        total: 2,
        usageCounts: {},
      });

      const result = await service.execute(makeRequest());

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories[0].id).toBe(parentA.id);
        expect(result.value.categories[1].id).toBe(parentB.id);
      }
    });
  });

  describe('filter mode (with parentId)', () => {
    it('should return root categories when parentId is "null"', async () => {
      const root = makeCategory({ name: 'Raiz' }, 'cat-root');
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [root],
        total: 1,
        usageCounts: {},
      });

      const result = await service.execute(makeRequest({ parentId: 'null' }));

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories).toHaveLength(1);
        expect(result.value.categories[0].name).toBe('Raiz');
        expect(result.value.hierarchy).toBeUndefined();
      }

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        { type: undefined, parentId: null, visibility: 'visible' },
        1,
        10,
      );
    });

    it('should return children when parentId is a specific id', async () => {
      const child = makeCategory(
        { parentId: 'parent-1', name: 'Filho' },
        'cat-child',
      );
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [child],
        total: 1,
        usageCounts: {},
      });

      const result = await service.execute(
        makeRequest({ parentId: 'parent-1' }),
      );

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories).toHaveLength(1);
        expect(result.value.hierarchy).toBeUndefined();
      }

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        { type: undefined, parentId: 'parent-1', visibility: 'visible' },
        1,
        10,
      );
    });

    it('should pass type filter alongside parentId', async () => {
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      await service.execute(
        makeRequest({
          parentId: 'null',
          type: TransactionType.INCOME,
        }),
      );

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        {
          type: TransactionType.INCOME,
          parentId: null,
          visibility: 'visible',
        },
        1,
        10,
      );
    });
  });

  describe('visibility filter', () => {
    it('should ask the repository for visible rows by default', async () => {
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      await service.execute(makeRequest());

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        { type: undefined, visibility: 'visible' },
      );
    });

    it('should ask the repository for every row when hidden=all', async () => {
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      await service.execute(makeRequest({ hidden: 'all' }));

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        { type: undefined, visibility: 'all' },
      );
    });

    it('should take the page total from the repository count', async () => {
      const root = makeCategory({ name: 'Raiz' }, 'cat-root');
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [root],
        total: 7,
        usageCounts: {},
      });

      const result = await service.execute(makeRequest({ parentId: 'null' }));

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories.map((category) => category.id)).toEqual([
          root.id,
        ]);
        expect(result.value.total).toBe(7);
      }
    });

    it('should promote visible children of a hidden parent to the root list', async () => {
      const visibleChild = makeCategory(
        { parentId: 'cat-hidden-parent', name: 'Mercado' },
        'cat-visible-child',
      );

      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [visibleChild],
        total: 1,
        usageCounts: {},
      });

      const result = await service.execute(makeRequest());

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories.map((category) => category.id)).toEqual([
          visibleChild.id,
        ]);
        expect(result.value.categories[0].parentId).toBe('cat-hidden-parent');
        expect(result.value.hierarchy).toEqual({});
        expect(result.value.total).toBe(1);
      }

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        { type: undefined, visibility: 'visible' },
      );
    });

    it('should keep visible children nested under a hidden parent when hidden=all', async () => {
      const hiddenParent = makeCategory(
        { name: 'Lazer', isHidden: true },
        'cat-hidden-parent',
      );
      const visibleChild = makeCategory(
        { parentId: hiddenParent.id, name: 'Cinema' },
        'cat-visible-child',
      );

      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [hiddenParent, visibleChild],
        total: 2,
        usageCounts: {},
      });

      const result = await service.execute(makeRequest({ hidden: 'all' }));

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories.map((category) => category.id)).toEqual([
          hiddenParent.id,
        ]);
        expect(result.value.hierarchy![hiddenParent.id]).toHaveLength(1);
        expect(result.value.hierarchy![hiddenParent.id][0].id).toBe(
          visibleChild.id,
        );
        expect(result.value.total).toBe(1);
      }

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        { type: undefined, visibility: 'all' },
      );
    });

    it('should key the cache by visibility', async () => {
      categoryRepository.findManyByWorkspaceId.mockResolvedValue({
        categories: [],
        total: 0,
        usageCounts: {},
      });

      await service.execute(makeRequest());
      await service.execute(makeRequest({ hidden: 'all' }));

      expect(redisService.get).toHaveBeenNthCalledWith(
        1,
        'categories:list:ws-1:g1:t=:p=none:h=false:1:10',
      );
      expect(redisService.get).toHaveBeenNthCalledWith(
        2,
        'categories:list:ws-1:g1:t=:p=none:h=all:1:10',
      );
    });

    it('should serve a cached payload as stored', async () => {
      const hidden = makeCategory(
        { name: 'Lazer', isHidden: true },
        'cat-hidden',
      );

      redisService.get.mockResolvedValue(
        JSON.stringify({
          categories: [
            {
              id: hidden.id,
              workspaceId: 'ws-1',
              name: hidden.name,
              type: 'EXPENSE',
              parentId: null,
              isSystemCategory: false,
              isHidden: true,
            },
          ],
          total: 1,
          hierarchy: null,
        }),
      );

      const result = await service.execute(makeRequest({ hidden: 'all' }));

      expect(result.isRight() && result.value.categories).toHaveLength(1);
      expect(result.isRight() && result.value.total).toBe(1);
      expect(categoryRepository.findManyByWorkspaceId).not.toHaveBeenCalled();
    });
  });
});
