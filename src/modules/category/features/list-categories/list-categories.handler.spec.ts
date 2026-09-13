import { TransactionType } from '@constants/enums';
import { RedisService } from '@infra/cache/redis/RedisService';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { ListCategoriesService } from './list-categories.handler';

function makeRequest(overrides = {}) {
  return { workspaceId: 'ws-1', page: 1, pageSize: 10, ...overrides };
}

function makeCategory(
  overrides: Partial<{
    workspaceId: string | null;
    name: string;
    type: TransactionType;
    parentId: string | null;
    isSystemCategory: boolean;
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

function makeRedisService(): jest.Mocked<RedisService> {
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
  } as unknown as jest.Mocked<RedisService>;
}

describe('ListCategoriesService', () => {
  let service: ListCategoriesService;
  let categoryRepository: jest.Mocked<CategoryRepository>;
  let redisService: jest.Mocked<RedisService>;

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
      expect(ttl).toBe(300);
      expect(typeof payload).toBe('string');
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
        { type: undefined },
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

      const result = await service.execute(
        makeRequest({ parentId: 'null' }),
      );

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categories).toHaveLength(1);
        expect(result.value.categories[0].name).toBe('Raiz');
        expect(result.value.hierarchy).toBeUndefined();
      }

      expect(categoryRepository.findManyByWorkspaceId).toHaveBeenCalledWith(
        'ws-1',
        { type: undefined, parentId: null },
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
        { type: undefined, parentId: 'parent-1' },
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
        { type: TransactionType.INCOME, parentId: null },
        1,
        10,
      );
    });
  });
});
