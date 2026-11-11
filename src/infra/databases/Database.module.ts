import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { CardCycleRepository } from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { ReportRepository } from '@modules/report/repositories/contracts/ReportRepository';
import { SubscriptionRepository } from '@modules/subscription/repositories/contracts/SubscriptionRepository';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { WorkspaceInviteRepository } from '@modules/workspace/repositories/contracts/WorkspaceInviteRepository';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Module } from '@nestjs/common';
import { DateModule } from '@providers/date/Date.module';
import {
  DrizzleProvider,
  DrizzleTokenProvider,
} from './drizzle/drizzle.provider';
import { DrizzleService } from './drizzle/drizzle.service';
import { AccountRepositoryImplementation } from './drizzle/repositories/account.repository';
import { AuthSessionRepositoryImplementation } from './drizzle/repositories/auth-session.repository';
import { BudgetRepositoryImplementation } from './drizzle/repositories/budget.repository';
import { CardCycleRepositoryImplementation } from './drizzle/repositories/card-cycle.repository';
import { CategoryRepositoryImplementation } from './drizzle/repositories/category.repository';
import { GoalRepositoryImplementation } from './drizzle/repositories/goal.repository';
import { MonthProjectionRepositoryImplementation } from './drizzle/repositories/month-projection.repository';
import { RecurringSuggestionRepositoryImplementation } from './drizzle/repositories/recurring-suggestion.repository';
import { RecurringTransactionRepositoryImplementation } from './drizzle/repositories/recurring-transaction.repository';
import { RefreshTokenRepositoryImplementation } from './drizzle/repositories/refresh-token.repository';
import { ReportRepositoryImplementation } from './drizzle/repositories/report.repository';
import { SubscriptionRepositoryImplementation } from './drizzle/repositories/subscription.repository';
import { TransactionRepositoryImplementation } from './drizzle/repositories/transaction.repository';
import { UserRepositoryImplementation } from './drizzle/repositories/user.repository';
import { WorkspaceInviteRepositoryImplementation } from './drizzle/repositories/workspace-invite.repository';
import { WorkspaceUserRepositoryImplementation } from './drizzle/repositories/workspace-user.repository';
import { WorkspaceRepositoryImplementation } from './drizzle/repositories/workspace.repository';

@Module({
  imports: [DateModule],
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
      provide: MonthProjectionRepository,
      useClass: MonthProjectionRepositoryImplementation,
    },
    {
      provide: RecurringTransactionRepository,
      useClass: RecurringTransactionRepositoryImplementation,
    },
    {
      provide: RecurringSuggestionRepository,
      useClass: RecurringSuggestionRepositoryImplementation,
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
      provide: GoalRepository,
      useClass: GoalRepositoryImplementation,
    },
    {
      provide: BudgetRepository,
      useClass: BudgetRepositoryImplementation,
    },
    {
      provide: SubscriptionRepository,
      useClass: SubscriptionRepositoryImplementation,
    },
    {
      provide: CardCycleRepository,
      useClass: CardCycleRepositoryImplementation,
    },
    {
      provide: ReportRepository,
      useClass: ReportRepositoryImplementation,
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
    MonthProjectionRepository,
    RecurringTransactionRepository,
    RecurringSuggestionRepository,
    AccountRepository,
    CategoryRepository,
    GoalRepository,
    BudgetRepository,
    CardCycleRepository,
    SubscriptionRepository,
    ReportRepository,
  ],
})
export class DatabaseModule {}
