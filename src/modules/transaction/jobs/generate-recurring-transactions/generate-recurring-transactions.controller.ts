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
import { GenerateRecurringTransactionsJobService } from './generate-recurring-transactions.service';

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

    const { generatedCount } = data.value;

    this.logger.log(
      `GenerateRecurringTransactionsJobService completed. Generated ${generatedCount} transactions.`,
    );
  }
}
