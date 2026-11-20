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
  DetectRecurringSuggestionsJobService,
  RecurringSuggestionDetectionJobOutcome,
  RecurringSuggestionDetectionJobSummary,
} from './detect-recurring-suggestions.service';

const JOB_NAME = DetectRecurringSuggestionsJobService.name;

const OUTCOME_LOG_LEVEL: Record<
  RecurringSuggestionDetectionJobOutcome,
  'log' | 'warn' | 'error'
> = {
  'nothing-due': 'log',
  success: 'log',
  'partial-failure': 'warn',
  'total-failure': 'error',
};

const summaryMessage = ({
  outcome,
  scanned,
  persisted,
  unchanged,
  notDue,
  failed,
  failedWorkspaceIds,
  truncated,
  lastCursor,
  skipped,
}: RecurringSuggestionDetectionJobSummary): string =>
  `${JOB_NAME} outcome=${outcome} scanned=${scanned} persisted=${persisted} unchanged=${unchanged} notDue=${notDue} failed=${failed} failedWorkspaceIds=${failedWorkspaceIds.join(',') || 'none'} truncated=${truncated} cursor=${lastCursor ?? 'none'} skipped=${skipped}`;

const failureBody = ({
  scanned,
  persisted,
  unchanged,
  notDue,
  failed,
  failedWorkspaceIds,
  truncated,
}: RecurringSuggestionDetectionJobSummary) => ({
  scanned,
  persisted,
  unchanged,
  notDue,
  failed,
  failedWorkspaceIds,
  truncated,
});

@ApiTags('Recurring Suggestion')
@Controller('internal')
export class DetectRecurringSuggestionsJobController {
  private readonly logger = new Logger(
    DetectRecurringSuggestionsJobController.name,
  );

  constructor(
    private readonly jobService: DetectRecurringSuggestionsJobService,
  ) {}

  @Public()
  @SkipAllRateLimits()
  @Post('recurring-suggestions-detect')
  @HttpCode(statusCode.OK)
  async handle(@ApiKey() apiKey: string) {
    if (!isAuthorizedCronCall(apiKey, env.CRON_API_KEY)) {
      throw new UnauthorizedException('Chave de CRON inválida ou ausente');
    }

    const summary = await this.jobService.execute();

    this.logger[OUTCOME_LOG_LEVEL[summary.outcome]](summaryMessage(summary));

    if (summary.failed > 0 || summary.truncated) {
      throw new InternalServerErrorException(failureBody(summary));
    }

    return summary;
  }
}
