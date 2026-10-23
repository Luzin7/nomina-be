import { RATE_LIMITS } from '@constants/rateLimits';
import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from '@infra/http/cookies/authCookie';
import {
  LimitByAccount,
  LimitByClient,
} from '@infra/http/throttling/decorators';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@providers/auth/decorators/IsPublic.decorator';
import { statusCode } from '@shared/core/types/statusCode';
import type { Response } from 'express';
import { LoginUserPipe, type LoginUserRequest } from './login-user.dto';
import { LoginUserService } from './login-user.service';

@ApiTags('Auth')
@Controller('auth')
export class LoginUserController {
  constructor(private readonly service: LoginUserService) {}

  @Public()
  @LimitByClient(RATE_LIMITS.client.login)
  @LimitByAccount(RATE_LIMITS.account.login)
  @Post('login')
  @HttpCode(statusCode.OK)
  async handle(
    @Headers('user-agent') agent: string | undefined,
    @Body(LoginUserPipe) body: LoginUserRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.service.execute({ ...body, agent });

    if (data.isLeft()) {
      clearRefreshTokenCookie(res);
      return ErrorPresenter.toHTTP(data.value);
    }

    setRefreshTokenCookie(res, data.value.refreshToken);

    return { data: { accessToken: data.value.accessToken } };
  }
}
