import { env } from '@infra/env';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { normalizePemNewlines } from '@utils/normalizePemNewlines';
import { JwtAuthGuard } from './guards/jwtAuth.guard';
import { RolesGuard } from './guards/Roles.guard';
import { JwtStrategy } from './strategys/jwtStrategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      global: true,
      useFactory() {
        return {
          signOptions: {
            algorithm: 'RS256',
          },
          privateKey: normalizePemNewlines(env.JWT_PRIVATE_KEY),
          publicKey: normalizePemNewlines(env.JWT_PUBLIC_KEY),
        };
      },
    }),
  ],
  providers: [
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AuthModule {}
