import { AccountModule } from '@modules/account/Account.module';
import { CategoryModule } from '@modules/category/Category.module';
import { ReportModule } from '@modules/report/Report.module';
import { SubscriptionModule } from '@modules/subscription/Subscription.module';
import { TransactionModule } from '@modules/transaction/Transaction.module';
import { UserModule } from '@modules/user/User.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '@providers/auth/Auth.module';
import { CryptographyModule } from '@providers/cryptography/Cryptography.module';
import { DateModule } from '@providers/date/Date.module';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup'; // <--- IMPORTAÇÃO ADICIONADA
import { RedisModule } from '../cache/Redis.module';
import { DatabaseModule } from '../databases/Database.module';
import { env } from '@infra/env';
import { AllExceptionsFilter } from './filters/AllExceptions.filter';
import { HealthController } from './healthCheck.controller';
import { LoggingInterceptor } from './interceptors/Logging.interceptor';
import { APP_GUARDS } from './throttling/AppThrottler.guard';
import { buildRateLimitOptions } from './throttling/rate-limit.options';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SentryModule.forRoot(),
    ThrottlerModule.forRoot(
      buildRateLimitOptions({
        enforce: env.NODE_ENV === 'production',
        internalKeys: env.NOMINA_INTERNAL_KEYS,
      }),
    ),
    DatabaseModule,
    RedisModule,
    AuthModule,
    CryptographyModule,
    DateModule,
    UserModule,
    WorkspaceModule,
    TransactionModule,
    AccountModule,
    CategoryModule,
    ReportModule,
    SubscriptionModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    ...APP_GUARDS,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
  controllers: [HealthController],
})
export class AppModule {}
