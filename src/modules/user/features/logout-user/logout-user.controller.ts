import { clearRefreshTokenCookie } from '@infra/http/cookies/authCookie';
import { Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@providers/auth/decorators/IsPublic.decorator';
import { RefreshToken } from '@providers/auth/decorators/refreshToken.decorator';
import { statusCode } from '@shared/core/types/statusCode';
import type { Response } from 'express';
import { LogoutUserService } from './logout-user.service';

@ApiTags('Auth')
@Controller('auth')
export class LogoutUserController {
  constructor(private readonly service: LogoutUserService) {}

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(statusCode.OK)
  async handle(
    @RefreshToken() refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.execute(refreshToken);

    clearRefreshTokenCookie(res);

    return { data: null };
  }
}
