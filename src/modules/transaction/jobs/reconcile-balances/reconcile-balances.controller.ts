import { env } from '@infra/env';
import {
  Controller,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKey } from '@providers/auth/decorators/ApiKey.decorator';
import { SkipAllRateLimits } from '@infra/http/throttling/decorators';
import { Public } from '@providers/auth/decorators/IsPublic.decorator';
import { statusCode } from '@shared/core/types/statusCode';
import { isAuthorizedCronCall } from '../is-authorized-cron-call';
import { ReconcileBalancesJobService } from './reconcile-balances.service';

@ApiTags('Balance Reconciliation')
@Controller('internal')
export class ReconcileBalancesJobController {
  private readonly logger = new Logger(ReconcileBalancesJobController.name);

  constructor(private readonly reconcileService: ReconcileBalancesJobService) {}

  @Public()
  @SkipAllRateLimits()
  @Post('reconcile-balances')
  @HttpCode(statusCode.OK)
  async handle(@ApiKey() apiKey: string) {
    if (!isAuthorizedCronCall(apiKey, env.CRON_API_KEY)) {
      throw new UnauthorizedException('Chave de CRON inválida ou ausente');
    }

    const summary = await this.reconcileService.execute();

    this.logger.log(
      `ReconcileBalancesJobService completed. Checked ${summary.accountsChecked} accounts, ${summary.divergences.length} divergences, ${summary.uncovered} uncovered.`,
    );

    return summary;
  }
}
