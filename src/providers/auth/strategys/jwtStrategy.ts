import { UserRole } from '@constants/enums';
import { env } from '@infra/env';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import z from 'zod';

export const tokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  workspaceId: z.string().uuid(),
  role: z.nativeEnum(UserRole),
});

export const refreshTokenPayloadSchema = z.object({
  sub: z.string().uuid(),
});

export type TokenPayloadSchema = z.infer<typeof tokenPayloadSchema>;

export type RefreshTokenPayload = z.infer<typeof refreshTokenPayloadSchema>;

export type TokenPayloadBase = Omit<TokenPayloadSchema, 'role'>;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: env.JWT_PUBLIC_KEY.replaceAll(String.raw`\n`, '\n'),
      algorithms: ['RS256'],
    });
  }

  async validate(payload: TokenPayloadSchema) {
    return tokenPayloadSchema.parse(payload);
  }
}
