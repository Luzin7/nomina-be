import { env } from '@infra/env';
import {
  Controller,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKey } from '@providers/auth/decorators/ApiKey.decorator';
import { Public } from '@providers/auth/decorators/IsPublic.decorator';
import { statusCode } from '@shared/core/types/statusCode';
import { isAuthorizedCronCall } from '../is-authorized-cron-call';
import {
  GenerateRecurringTransactionsJobService,
  GenerateRecurringTransactionsSummary,
  RecurringGenerationOutcome,
} from './generate-recurring-transactions.service';

const JOB_NAME = GenerateRecurringTransactionsJobService.name;

type OutcomeMessage = (summary: GenerateRecurringTransactionsSummary) => string;

const OUTCOME_MESSAGES: Record<RecurringGenerationOutcome, OutcomeMessage> = {
  'skipped-already-processed': () =>
    `${JOB_NAME} skipped: the day is already marked as processed.`,
  'skipped-lock-held': () => `${JOB_NAME} skipped: another run holds the lock.`,
  'nothing-due': () =>
    `${JOB_NAME} completed: no recurring transactions were due.`,
  success: ({ generatedCount, processedCount }) =>
    `${JOB_NAME} completed: generated ${generatedCount} transactions from ${processedCount} recurring transactions, no failures.`,
  'partial-failure': ({ generatedCount, failedCount, processedCount }) =>
    `${JOB_NAME} completed with failures: generated ${generatedCount} transactions from ${processedCount} recurring transactions, ${failedCount} of ${processedCount} failed.`,
  'total-failure': ({ generatedCount, failedCount, processedCount }) =>
    `${JOB_NAME} failed: generated ${generatedCount} transactions from ${processedCount} recurring transactions, all ${failedCount} failed.`,
};

const OUTCOME_LOG_LEVEL: Record<
  RecurringGenerationOutcome,
  'log' | 'warn' | 'error'
> = {
  'skipped-already-processed': 'log',
  'skipped-lock-held': 'log',
  'nothing-due': 'log',
  success: 'log',
  'partial-failure': 'warn',
  'total-failure': 'error',
};

@ApiTags('Recurring Transaction')
@Controller('internal')
export class GenerateRecurringTransactionsJobController {
  private readonly logger = new Logger(
    GenerateRecurringTransactionsJobController.name,
  );

  constructor(
    private readonly generateService: GenerateRecurringTransactionsJobService,
  ) {}

  @Public()
  @Post('generate-recurring-transactions')
  @HttpCode(statusCode.OK)
  async handle(@ApiKey() apiKey: string) {
    if (!isAuthorizedCronCall(apiKey, env.CRON_API_KEY)) {
      throw new UnauthorizedException('Chave de CRON inválida ou ausente');
    }

    const data = await this.generateService.execute();

    if (data.isLeft()) {
      throw new InternalServerErrorException(data.value.message);
    }

    this.logOutcome(data.value);
  }

  private logOutcome(summary: GenerateRecurringTransactionsSummary): void {
    this.logger[OUTCOME_LOG_LEVEL[summary.outcome]](
      OUTCOME_MESSAGES[summary.outcome](summary),
    );
  }
}
