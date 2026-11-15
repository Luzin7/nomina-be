import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { UserRole } from '@constants/enums';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { PlanType } from '../constants/PlanLimits';
import { Subscription } from '../entities/Subscription';
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

function makeSubscription(planId: string): Subscription {
  const result = Subscription.create({
    userId: 'owner-1',
    planId,
    currentPeriodEnd: new Date(Date.now() + 86_400_000),
  });
  if (result.isLeft()) throw result.value;
  return result.value;
}

interface ServiceOverrides {
  subscription?: Subscription | null;
  workspaceCount?: number;
  memberCount?: number;
  accountCount?: number;
}

function makeService(overrides: ServiceOverrides = {}) {
  const workspaceUserRepository = {
    findOwnerByWorkspaceId: jest.fn().mockResolvedValue(makeOwner()),
    countByWorkspaceId: jest.fn().mockResolvedValue(overrides.memberCount ?? 0),
  } as unknown as jest.Mocked<WorkspaceUserRepository>;
  const workspaceRepository = {
    countOwnedByUserId: jest
      .fn()
      .mockResolvedValue(overrides.workspaceCount ?? 0),
  } as unknown as jest.Mocked<WorkspaceRepository>;
  const accountRepository = {
    countByWorkspaceId: jest
      .fn()
      .mockResolvedValue(overrides.accountCount ?? 0),
  } as unknown as jest.Mocked<AccountRepository>;
  const subscriptionRepository = {
    findByUserId: jest.fn().mockResolvedValue(overrides.subscription ?? null),
  } as unknown as jest.Mocked<SubscriptionRepository>;

  return new CheckSubscriptionLimitsService(
    subscriptionRepository,
    workspaceRepository,
    workspaceUserRepository,
    accountRepository,
    {} as CategoryRepository,
  );
}

describe('CheckSubscriptionLimitsService', () => {
  it('should block a workspace member beyond the trial limit with the member message', async () => {
    const service = makeService({
      subscription: makeSubscription(PlanType.TRIAL),
      memberCount: 10,
    });

    const result = await service.execute({
      userId: 'owner-1',
      resourceType: ResourceType.WORKSPACE_MEMBER,
      workspaceId: 'ws-1',
    });

    expect(result.value).toBeInstanceOf(WorkspaceMemberLimitReachedError);
    expect((result.value as Error).message).toBe(
      'Seu plano permite até 10 pessoas por workspace.',
    );
  });

  it.each([PlanType.TRIAL, PlanType.FREE])(
    'should not block a realistic MVP workspace on %s',
    async (planId) => {
      const service = makeService({
        subscription: makeSubscription(planId),
        workspaceCount: 4,
        memberCount: 5,
        accountCount: 10,
      });

      const account = await service.execute({
        userId: 'owner-1',
        resourceType: ResourceType.ACCOUNT,
        workspaceId: 'ws-1',
      });
      const member = await service.execute({
        userId: 'owner-1',
        resourceType: ResourceType.WORKSPACE_MEMBER,
        workspaceId: 'ws-1',
      });
      const workspace = await service.execute({
        userId: 'owner-1',
        resourceType: ResourceType.WORKSPACE,
      });

      expect(account.value).toEqual({
        allowed: true,
        currentCount: 10,
        limit: 50,
      });
      expect(member.value).toEqual({
        allowed: true,
        currentCount: 5,
        limit: 10,
      });
      expect(workspace.value).toEqual({
        allowed: true,
        currentCount: 4,
        limit: 5,
      });
    },
  );
});
