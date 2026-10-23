import { env } from '@infra/env';
import { SkipAllRateLimits } from '@infra/http/throttling/decorators';
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
  SettleCardInstallmentsJobService,
  SettleCardInstallmentsOutcome,
  SettleCardInstallmentsSummary,
} from './settle-card-installments.service';

const JOB_NAME = SettleCardInstallmentsJobService.name;

type OutcomeMessage = (summary: SettleCardInstallmentsSummary) => string;

const OUTCOME_MESSAGES: Record<SettleCardInstallmentsOutcome, OutcomeMessage> =
  {
    'nothing-due': () =>
      `${JOB_NAME} completed: no card transactions were due.`,
    success: ({ settledCount, skippedCount, processedCount }) =>
      `${JOB_NAME} completed: settled ${settledCount} of ${processedCount} card transactions (${skippedCount} already settled by another run), no failures.`,
    'partial-failure': ({ settledCount, failedCount, processedCount }) =>
      `${JOB_NAME} completed with failures: settled ${settledCount} of ${processedCount} card transactions, ${failedCount} of ${processedCount} failed.`,
    'total-failure': ({ settledCount, failedCount, processedCount }) =>
      `${JOB_NAME} failed: settled ${settledCount} of ${processedCount} card transactions, all ${failedCount} failed.`,
  };

const OUTCOME_LOG_LEVEL: Record<
  SettleCardInstallmentsOutcome,
  'log' | 'warn' | 'error'
> = {
  'nothing-due': 'log',
  success: 'log',
  'partial-failure': 'warn',
  'total-failure': 'error',
};

@ApiTags('Credit Card Settlement')
@Controller('internal')
export class SettleCardInstallmentsJobController {
  private readonly logger = new Logger(
    SettleCardInstallmentsJobController.name,
  );

  constructor(
    private readonly settleService: SettleCardInstallmentsJobService,
  ) {}

  @Public()
  @SkipAllRateLimits()
  @Post('settle-card-installments')
  @HttpCode(statusCode.OK)
  async handle(@ApiKey() apiKey: string) {
    if (!isAuthorizedCronCall(apiKey, env.CRON_API_KEY)) {
      throw new UnauthorizedException('Chave de CRON inválida ou ausente');
    }

    const summary = await this.settleService.execute();

    this.logger[OUTCOME_LOG_LEVEL[summary.outcome]](
      OUTCOME_MESSAGES[summary.outcome](summary),
    );

    if (summary.outcome === 'total-failure') {
      throw new InternalServerErrorException(
        OUTCOME_MESSAGES[summary.outcome](summary),
      );
    }

    return summary;
  }
}
