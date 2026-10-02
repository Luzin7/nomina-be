import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { REFRESH_TOKEN_COOKIE, readCookie } from '@shared/utils/cookies';

export const RefreshToken = createParamDecorator(
  (_: unknown, context: ExecutionContext): string | undefined => {
    const request = context.switchToHttp().getRequest();
    return readCookie(request.headers?.cookie, REFRESH_TOKEN_COOKIE);
  },
);
