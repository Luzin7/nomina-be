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
  AutoPayCardInvoicesJobService,
  AutopayOutcome,
  AutopaySummary,
} from './auto-pay-card-invoices.service';

const JOB_NAME = AutoPayCardInvoicesJobService.name;

type OutcomeMessage = (summary: AutopaySummary) => string;

const OUTCOME_MESSAGES: Record<AutopayOutcome, OutcomeMessage> = {
  'nothing-due': () => `${JOB_NAME} completed: no card invoice was processed.`,
  success: ({ settledCount, processedCount }) =>
    `${JOB_NAME} completed: registered ${settledCount} invoice payment(s) out of ${processedCount} processed, no failures.`,
  'partial-failure': ({ settledCount, failedCount, processedCount }) =>
    `${JOB_NAME} completed with failures: registered ${settledCount} invoice payment(s), ${failedCount} of ${processedCount} failed.`,
  'total-failure': ({ failedCount, processedCount }) =>
    `${JOB_NAME} failed: no invoice payment registered, ${failedCount} of ${processedCount} failed.`,
};

const OUTCOME_LOG_LEVEL: Record<AutopayOutcome, 'log' | 'warn' | 'error'> = {
  'nothing-due': 'log',
  success: 'log',
  'partial-failure': 'warn',
  'total-failure': 'error',
};

@ApiTags('Credit Card Settlement')
@Controller('internal')
export class AutoPayCardInvoicesJobController {
  private readonly logger = new Logger(AutoPayCardInvoicesJobController.name);

  constructor(private readonly autoPayService: AutoPayCardInvoicesJobService) {}

  @Public()
  @SkipAllRateLimits()
  @Post('auto-pay-card-invoices')
  @HttpCode(statusCode.OK)
  async handle(@ApiKey() apiKey: string) {
    if (!isAuthorizedCronCall(apiKey, env.CRON_API_KEY)) {
      throw new UnauthorizedException('Chave de CRON inválida ou ausente');
    }

    const summary = await this.autoPayService.execute();

    this.logger[OUTCOME_LOG_LEVEL[summary.outcome]](
      `${OUTCOME_MESSAGES[summary.outcome](summary)} skipped=${JSON.stringify(summary.skipped)} remaining=${summary.remainingCount} lockBusy=${summary.lockBusy}`,
    );

    if (summary.outcome === 'total-failure') {
      throw new InternalServerErrorException(
        OUTCOME_MESSAGES[summary.outcome](summary),
      );
    }

    return summary;
  }
}
