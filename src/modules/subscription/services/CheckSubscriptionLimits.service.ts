import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { getPlanLimits } from '../constants/PlanLimits';
import {
  MissingWorkspaceIdError,
  PlanLimitReachedError,
  SubscriptionNotActiveError,
  WorkspaceMemberLimitReachedError,
} from '../errors';
import { SubscriptionRepository } from '../repositories/contracts/SubscriptionRepository';

export enum ResourceType {
  WORKSPACE = 'workspace',
  WORKSPACE_MEMBER = 'workspace_member',
  ACCOUNT = 'account',
  CATEGORY = 'category',
}

interface Request {
  userId: string; // Usuário executando a ação
  resourceType: ResourceType;
  workspaceId?: string;
}

interface Response {
  allowed: boolean;
  currentCount: number;
  limit: number;
}

@Injectable()
export class CheckSubscriptionLimitsService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
    private readonly accountRepository: AccountRepository,
    private readonly categoryRepository: CategoryRepository,
  ) {}

  async execute({
    userId,
    resourceType,
    workspaceId,
  }: Request): Promise<Either<Error, Response>> {
    let billingUserId = userId;

    if (workspaceId && resourceType !== ResourceType.WORKSPACE) {
      const ownerVinc =
        await this.workspaceUserRepository.findOwnerByWorkspaceId(workspaceId);
      if (!ownerVinc) {
        return left(new UnauthorizedError());
      }
      billingUserId = ownerVinc.userId;
    }

    const subscription =
      await this.subscriptionRepository.findByUserId(billingUserId);
    const planId = subscription?.planId ?? 'plan_free';
    const limits = getPlanLimits(planId);

    if (subscription && !subscription.hasAccess()) {
      return left(new SubscriptionNotActiveError());
    }

    switch (resourceType) {
      case ResourceType.WORKSPACE:
        return this.checkLimit(limits.maxWorkspaces, () =>
          this.workspaceRepository.countOwnedByUserId(billingUserId),
        );

      case ResourceType.WORKSPACE_MEMBER:
        if (!workspaceId) return left(new MissingWorkspaceIdError());
        return this.checkLimit(
          limits.maxMembersPerWorkspace,
          () => this.workspaceUserRepository.countByWorkspaceId(workspaceId),
          () =>
            new WorkspaceMemberLimitReachedError(limits.maxMembersPerWorkspace),
        );

      case ResourceType.ACCOUNT:
        if (!workspaceId) return left(new MissingWorkspaceIdError());
        return this.checkLimit(limits.maxAccountsPerWorkspace, () =>
          this.accountRepository.countByWorkspaceId(workspaceId),
        );

      case ResourceType.CATEGORY:
        if (!workspaceId) return left(new MissingWorkspaceIdError());
        return this.checkLimit(limits.maxCategories, () =>
          this.categoryRepository.countByWorkspaceId(workspaceId),
        );

      default:
        return right({ allowed: true, currentCount: 0, limit: -1 });
    }
  }

  private async checkLimit(
    limit: number,
    countFn: () => Promise<number>,
    limitReachedError: (currentCount: number) => Error = (currentCount) =>
      new PlanLimitReachedError(currentCount, limit),
  ): Promise<Either<Error, Response>> {
    if (limit === -1) {
      return right({ allowed: true, currentCount: 0, limit: -1 });
    }

    const currentCount = await countFn();

    if (currentCount >= limit) {
      return left(limitReachedError(currentCount));
    }

    return right({ allowed: true, currentCount, limit });
  }
}
