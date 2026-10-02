import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from '@infra/http/cookies/authCookie';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Controller, Post, HttpCode, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@providers/auth/decorators/IsPublic.decorator';
import { RefreshToken } from '@providers/auth/decorators/refreshToken.decorator';
import { statusCode } from '@shared/core/types/statusCode';
import type { Response } from 'express';
import { RefreshTokenService } from './refresh-token.service';

@ApiTags('Auth')
@Controller('auth')
export class RefreshTokenController {
  constructor(private readonly service: RefreshTokenService) {}

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('/session/refresh')
  @HttpCode(statusCode.OK)
  async handle(
    @RefreshToken() refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.service.execute(refreshToken);

    if (data.isLeft()) {
      clearRefreshTokenCookie(res);
      return ErrorPresenter.toHTTP(data.value);
    }

    setRefreshTokenCookie(res, data.value.refreshToken);

    return { data: { accessToken: data.value.accessToken } };
  }
}
