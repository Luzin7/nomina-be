import { RATE_LIMITS } from '@constants/rateLimits';
import {
  LimitByAccount,
  LimitByClient,
} from '@infra/http/throttling/decorators';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@providers/auth/decorators/IsPublic.decorator';
import { statusCode } from '@shared/core/types/statusCode';
import { CreateUserPipe, type CreateUserRequest } from './create-user.dto';
import { CreateUserService } from './create-user.service';

@ApiTags('User')
@Controller('user')
export class CreateUserController {
  constructor(private readonly service: CreateUserService) {}

  @Public()
  @LimitByClient(RATE_LIMITS.client.createUser)
  @LimitByAccount(RATE_LIMITS.account.createUser)
  @Post()
  @HttpCode(statusCode.CREATED)
  async handle(@Body(CreateUserPipe) body: CreateUserRequest) {
    const result = await this.service.execute(body);

    if (result.isLeft()) {
      return ErrorPresenter.toHTTP(result.value);
    }
  }
}
