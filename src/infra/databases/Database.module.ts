import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { SubscriptionRepository } from '@modules/subscription/repositories/contracts/SubscriptionRepository';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { WorkspaceInviteRepository } from '@modules/workspace/repositories/contracts/WorkspaceInviteRepository';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Module } from '@nestjs/common';
import {
  DrizzleProvider,
  DrizzleTokenProvider,
} from './drizzle/drizzle.provider';
import { DrizzleService } from './drizzle/drizzle.service';
import { AccountRepositoryImplementation } from './drizzle/repositories/account.repository';
import { AuthSessionRepositoryImplementation } from './drizzle/repositories/auth-session.repository';
import { CategoryRepositoryImplementation } from './drizzle/repositories/category.repository';
import { RecurringTransactionRepositoryImplementation } from './drizzle/repositories/recurring-transaction.repository';
import { RefreshTokenRepositoryImplementation } from './drizzle/repositories/refresh-token.repository';
import { SubscriptionRepositoryImplementation } from './drizzle/repositories/subscription.repository';
import { TransactionRepositoryImplementation } from './drizzle/repositories/transaction.repository';
import { UserRepositoryImplementation } from './drizzle/repositories/user.repository';
import { WorkspaceInviteRepositoryImplementation } from './drizzle/repositories/workspace-invite.repository';
import { WorkspaceUserRepositoryImplementation } from './drizzle/repositories/workspace-user.repository';
import { WorkspaceRepositoryImplementation } from './drizzle/repositories/workspace.repository';

@Module({
  providers: [
    DrizzleProvider,
    DrizzleTokenProvider,
    DrizzleService,
    {
      provide: UserRepository,
      useClass: UserRepositoryImplementation,
    },
    {
      provide: WorkspaceRepository,
      useClass: WorkspaceRepositoryImplementation,
    },
    {
      provide: WorkspaceUserRepository,
      useClass: WorkspaceUserRepositoryImplementation,
    },
    {
      provide: WorkspaceInviteRepository,
      useClass: WorkspaceInviteRepositoryImplementation,
    },
    {
      provide: RefreshTokensRepository,
      useClass: RefreshTokenRepositoryImplementation,
    },
    {
      provide: AuthSessionsRepository,
      useClass: AuthSessionRepositoryImplementation,
    },
    {
      provide: TransactionRepository,
      useClass: TransactionRepositoryImplementation,
    },
    {
      provide: RecurringTransactionRepository,
      useClass: RecurringTransactionRepositoryImplementation,
    },
    {
      provide: AccountRepository,
      useClass: AccountRepositoryImplementation,
    },
    {
      provide: CategoryRepository,
      useClass: CategoryRepositoryImplementation,
    },
    {
      provide: SubscriptionRepository,
      useClass: SubscriptionRepositoryImplementation,
    },
  ],
  exports: [
    DrizzleService,
    UserRepository,
    WorkspaceRepository,
    WorkspaceUserRepository,
    WorkspaceInviteRepository,
    RefreshTokensRepository,
    AuthSessionsRepository,
    TransactionRepository,
    RecurringTransactionRepository,
    AccountRepository,
    CategoryRepository,
    SubscriptionRepository,
  ],
})
export class DatabaseModule {}
