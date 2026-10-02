import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from '@infra/http/cookies/authCookie';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(statusCode.OK)
  async handle(
    @Body(LoginUserPipe) body: LoginUserRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.service.execute(body);

    if (data.isLeft()) {
      clearRefreshTokenCookie(res);
      return ErrorPresenter.toHTTP(data.value);
    }

    setRefreshTokenCookie(res, data.value.refreshToken);

    return { data: { accessToken: data.value.accessToken } };
  }
}
