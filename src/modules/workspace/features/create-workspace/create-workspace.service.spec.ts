import { TransactionType, UserRole } from '@constants/enums';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { CreateWorkspaceService } from './create-workspace.service';

function makeCategory(id: string): Category {
  return Category.reconstitute(
    {
      workspaceId: 'ws-1',
      name: 'Categoria',
      type: TransactionType.EXPENSE,
      parentId: null,
      isSystemCategory: false,
    },
    id,
  );
}

function makeRequest(overrides = {}) {
  return {
    name: 'My Workspace',
    currency: 'BRL',
    isDefault: true,
    sub: 'user-1',
    ...overrides,
  };
}

describe('CreateWorkspaceService', () => {
  let service: CreateWorkspaceService;
  let workspaceRepository: jest.Mocked<WorkspaceRepository>;
  let categoryRepository: jest.Mocked<CategoryRepository>;

  beforeEach(() => {
    workspaceRepository = {
      createWithOwnerAndAccount: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      findTimezoneById: jest.fn(),
      findOwnedByUserId: jest.fn(),
      countOwnedByUserId: jest.fn(),
    } as jest.Mocked<WorkspaceRepository>;

    categoryRepository = {
      create: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      countByWorkspaceId: jest.fn(),
      findUniqueByAttributes: jest.fn(),
      countChildren: jest.fn(),
      countTransactions: jest.fn(),
      reassignChildren: jest.fn(),
      findManyByIds: jest.fn(),
      findSystemCategoryByName: jest.fn(),
    } as jest.Mocked<CategoryRepository>;

    service = new CreateWorkspaceService(
      workspaceRepository,
      categoryRepository,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should create workspace and workspaceUser successfully', async () => {
    workspaceRepository.createWithOwnerAndAccount.mockResolvedValue();
    categoryRepository.create.mockResolvedValue(makeCategory('cat-1'));

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.workspace).toBeDefined();
      expect(result.value.workspaceUser).toBeDefined();
      expect(result.value.workspaceUser.role).toBe(UserRole.OWNER);
      expect(result.value.workspaceUser.userId).toBe('user-1');
    }
    expect(workspaceRepository.createWithOwnerAndAccount).toHaveBeenCalledTimes(
      1,
    );
  });

  it('should return left when workspace name is too short', async () => {
    const result = await service.execute(makeRequest({ name: 'A' }));
    expect(result.isLeft()).toBe(true);
    expect(
      workspaceRepository.createWithOwnerAndAccount,
    ).not.toHaveBeenCalled();
  });

  it('should seed default categories after workspace creation', async () => {
    workspaceRepository.createWithOwnerAndAccount.mockResolvedValue();
    categoryRepository.create.mockResolvedValue(makeCategory('cat-1'));

    await service.execute(makeRequest());

    const createdCalls = categoryRepository.create.mock.calls;
    expect(createdCalls.length).toBeGreaterThan(1);

    const firstCall = createdCalls[0][0];
    expect(firstCall.isSystemCategory).toBe(false);
    expect(firstCall.workspaceId).toBeDefined();
    expect(firstCall.parentId).toBeNull();
  });

  it('should map parentId correctly for child categories', async () => {
    let callCount = 0;
    const idMap = new Map<string, string>();

    workspaceRepository.createWithOwnerAndAccount.mockResolvedValue();

    categoryRepository.create.mockImplementation(async (category) => {
      const id = `ws-cat-${++callCount}`;
      idMap.set(category.name, id);
      return makeCategory(id);
    });

    await service.execute(makeRequest());

    const childCalls = categoryRepository.create.mock.calls.filter(
      ([cat]) => cat.parentId !== null,
    );

    for (const [child] of childCalls) {
      expect(child.parentId).toBeDefined();
      expect(typeof child.parentId).toBe('string');
      expect(child.parentId).not.toBeNull();
    }
  });
});
