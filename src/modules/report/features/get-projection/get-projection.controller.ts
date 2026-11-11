import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { toHTTPProjectionHorizon } from '@modules/report/presenters/ProjectionHorizon.presenter';
import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  GetProjectionPipe,
  type GetProjectionRequest,
} from './get-projection.dto';
import { GetProjectionService } from './get-projection.handler';

@ApiTags('Report')
@Controller('projection')
export class GetProjectionController {
  constructor(private readonly service: GetProjectionService) {}

  @Get()
  @HttpCode(statusCode.OK)
  @ApiQuery({ name: 'months', required: false, type: Number, example: 6 })
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Query(GetProjectionPipe) query: GetProjectionRequest,
  ) {
    const data = await this.service.execute({ ...query, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return toHTTPProjectionHorizon(data.value);
  }
}
