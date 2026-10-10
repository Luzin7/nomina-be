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
import { Public } from '@providers/auth/decorators/IsPublic.decorator';
import { statusCode } from '@shared/core/types/statusCode';
import { GenerateRecurringTransactionsJobService } from './create-recurring-transaction.service';
import { isAuthorizedCronCall } from './is-authorized-cron-call';

@ApiTags('Recurring Transaction')
@Controller('internal')
export class GenerateRecurringTransactionJobController {
  private readonly logger = new Logger(
    GenerateRecurringTransactionJobController.name,
  );

  constructor(
    private readonly createService: GenerateRecurringTransactionsJobService,
  ) {}

  @Public()
  @Post('generate-recurring-transactions')
  @HttpCode(statusCode.OK)
  async handle(@ApiKey() apiKey: string) {
    if (!isAuthorizedCronCall(apiKey, env.CRON_API_KEY)) {
      throw new UnauthorizedException('Chave de CRON inválida ou ausente');
    }
    const data = await this.createService.execute();

    if (data.isLeft()) {
      this.logger.error(
        'Error executing GenerateRecurringTransactionsJobService:',
        data.value,
      );
      return;
    }

    const { generatedCount } = data.value;

    this.logger.log(
      `GenerateRecurringTransactionsJobService completed. Generated ${generatedCount} transactions.`,
    );
  }
}
