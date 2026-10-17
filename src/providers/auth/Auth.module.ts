import { env } from '@infra/env';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
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
          privateKey: env.JWT_PRIVATE_KEY.replaceAll(String.raw`\n`, '\n'),
          publicKey: env.JWT_PUBLIC_KEY.replaceAll(String.raw`\n`, '\n'),
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
