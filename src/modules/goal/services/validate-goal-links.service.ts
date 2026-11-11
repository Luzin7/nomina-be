import { AccountType } from '@constants/enums';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import {
  GoalCategoryInvalidError,
  GoalLinkedAccountInvalidError,
} from '@modules/goal/errors';
import { Injectable } from '@nestjs/common';

export type GoalLinkInput = {
  linkedAccountId?: string | null;
  categoryId?: string | null;
};

@Injectable()
export class ValidateGoalLinksService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly categoryRepository: CategoryRepository,
  ) {}

  async execute(
    workspaceId: string,
    { linkedAccountId, categoryId }: GoalLinkInput,
  ): Promise<Error | null> {
    if (linkedAccountId) {
      const account = await this.accountRepository.findById(linkedAccountId);

      if (
        !account ||
        account.workspaceId !== workspaceId ||
        account.type === AccountType.CREDIT_CARD
      ) {
        return new GoalLinkedAccountInvalidError();
      }
    }

    if (categoryId) {
      const category = await this.categoryRepository.findById(categoryId);

      if (
        !category ||
        (category.workspaceId !== null && category.workspaceId !== workspaceId)
      ) {
        return new GoalCategoryInvalidError();
      }
    }

    return null;
  }
}
