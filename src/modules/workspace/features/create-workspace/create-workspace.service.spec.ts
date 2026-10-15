import { UserRole } from '@constants/enums';
import { Category } from '@modules/category/entities/Category';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { CreateWorkspaceService } from './create-workspace.service';

function makeRequest(overrides = {}) {
  return {
    name: 'My Workspace',
    currency: 'BRL',
    isDefault: true,
    sub: 'user-1',
    ...overrides,
  };
}

function makeService(workspaceRepository: jest.Mocked<WorkspaceRepository>) {
  return new CreateWorkspaceService(workspaceRepository);
}

function categoriesFromLastCall(
  workspaceRepository: jest.Mocked<WorkspaceRepository>,
): Category[] {
  return workspaceRepository.createWithOwnerAndAccount.mock.calls[0][2];
}

describe('CreateWorkspaceService', () => {
  let service: CreateWorkspaceService;
  let workspaceRepository: jest.Mocked<WorkspaceRepository>;

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

    service = makeService(workspaceRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('should create workspace and workspaceUser successfully', async () => {
    workspaceRepository.createWithOwnerAndAccount.mockResolvedValue();

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

  it('should hand the full default tree to the same repository call', async () => {
    workspaceRepository.createWithOwnerAndAccount.mockResolvedValue();

    await service.execute(makeRequest());

    expect(categoriesFromLastCall(workspaceRepository)).toHaveLength(37);
  });

  it('should give every category a unique id and link children to their parent', async () => {
    workspaceRepository.createWithOwnerAndAccount.mockResolvedValue();

    await service.execute(makeRequest());

    const categories = categoriesFromLastCall(workspaceRepository);
    const ids = new Set(categories.map((category) => category.id));
    expect(ids.size).toBe(categories.length);

    const parent = categories.find(
      (category) => category.name === 'Alimentação',
    );
    const child = categories.find((category) => category.name === 'Mercado');
    expect(parent?.parentId).toBeNull();
    expect(child?.parentId).toBe(parent?.id);
    expect(
      categories.every((category) => category.isSystemCategory === false),
    ).toBe(true);
  });
});
