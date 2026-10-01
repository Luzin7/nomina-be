import { AccountModule } from '@modules/account/Account.module';
import { CategoryModule } from '@modules/category/Category.module';
import { ReportModule } from '@modules/report/Report.module';
import { SubscriptionModule } from '@modules/subscription/Subscription.module';
import { TransactionModule } from '@modules/transaction/Transaction.module';
import { UserModule } from '@modules/user/User.module';
import { WorkspaceModule } from '@modules/workspace/Workspace.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '@providers/auth/Auth.module';
import { JwtAuthGuard } from '@providers/auth/guards/jwtAuth.guard';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { CryptographyModule } from '@providers/cryptography/Cryptography.module';
import { DateModule } from '@providers/date/Date.module';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup'; // <--- IMPORTAÇÃO ADICIONADA
import { RedisModule } from '../cache/Redis.module';
import { DatabaseModule } from '../databases/Database.module';
import { AllExceptionsFilter } from './filters/AllExceptions.filter';
import { HealthController } from './healthCheck.controller';
import { LoggingInterceptor } from './interceptors/Logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SentryModule.forRoot(),
    ThrottlerModule.forRoot(
      process.env.NODE_ENV === 'production'
        ? [
            { name: 'default', ttl: 60_000, limit: 600 },
            { name: 'auth', ttl: 60_000, limit: 20 },
          ]
        : [
            { name: 'default', ttl: 60_000, limit: Number.MAX_SAFE_INTEGER },
            { name: 'auth', ttl: 60_000, limit: Number.MAX_SAFE_INTEGER },
          ],
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
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
  controllers: [HealthController],
})
export class AppModule {}
