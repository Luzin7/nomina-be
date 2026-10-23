import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { UserRole } from '@constants/enums';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { WorkspaceMemberLimitReachedError } from '../errors';
import { SubscriptionRepository } from '../repositories/contracts/SubscriptionRepository';
import {
  CheckSubscriptionLimitsService,
  ResourceType,
} from './CheckSubscriptionLimits.service';

function makeOwner(): WorkspaceUser {
  const result = WorkspaceUser.create({
    workspaceId: 'ws-1',
    userId: 'owner-1',
    role: UserRole.OWNER,
    isDefault: true,
  });
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('CheckSubscriptionLimitsService', () => {
  let service: CheckSubscriptionLimitsService;
  let workspaceUserRepository: jest.Mocked<WorkspaceUserRepository>;

  beforeEach(() => {
    workspaceUserRepository = {
      findOwnerByWorkspaceId: jest.fn().mockResolvedValue(makeOwner()),
      countByWorkspaceId: jest.fn().mockResolvedValue(3),
    } as unknown as jest.Mocked<WorkspaceUserRepository>;
    service = new CheckSubscriptionLimitsService(
      {
        findByUserId: jest.fn().mockResolvedValue(null),
      } as unknown as SubscriptionRepository,
      {} as WorkspaceRepository,
      workspaceUserRepository,
      {} as AccountRepository,
      {} as CategoryRepository,
    );
  });

  it('should block a workspace member beyond the plan limit with the member message', async () => {
    const result = await service.execute({
      userId: 'owner-1',
      resourceType: ResourceType.WORKSPACE_MEMBER,
      workspaceId: 'ws-1',
    });

    expect(result.value).toBeInstanceOf(WorkspaceMemberLimitReachedError);
    expect((result.value as Error).message).toBe(
      'Seu plano permite até 3 pessoas por workspace.',
    );
  });
});
