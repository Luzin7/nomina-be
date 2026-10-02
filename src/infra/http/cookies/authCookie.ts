import { env } from '@infra/env';
import { REFRESH_TOKEN_COOKIE } from '@shared/utils/cookies';
import type { CookieOptions, Response } from 'express';

const isProduction = env.NODE_ENV === 'production';
const SECOND_IN_MS = 1000;

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/api',
};

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookieOptions,
    maxAge: Number(env.JWT_USER_REFRESH_EXPIRES_IN) * SECOND_IN_MS,
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions);
}
