import { DatabaseModule } from '@infra/databases/Database.module';
import { Module } from '@nestjs/common';
import { CryptographyModule } from '@providers/cryptography/Cryptography.module';
import { DateModule } from '@providers/date/Date.module';
import { CreateUserController } from './features/create-user/create-user.controller';
import { GetProfileController } from './features/get-profile/get-profile.controller';
import { LoginUserController } from './features/login-user/login-user.controller';
import { LogoutUserController } from './features/logout-user/logout-user.controller';
import { RefreshTokenController } from './features/refresh-token/refresh-token.controller';
import { CreateUserService } from './features/create-user/create-user.service';
import { GetProfileService } from './features/get-profile/get-profile.service';
import { LoginUserService } from './features/login-user/login-user.service';
import { LogoutUserService } from './features/logout-user/logout-user.service';
import { RefreshTokenService } from './features/refresh-token/refresh-token.service';

@Module({
  controllers: [
    CreateUserController,
    GetProfileController,
    LoginUserController,
    LogoutUserController,
    RefreshTokenController,
  ],
  imports: [DatabaseModule, CryptographyModule, DateModule],
  providers: [
    CreateUserService,
    GetProfileService,
    LoginUserService,
    LogoutUserService,
    RefreshTokenService,
  ],
})
export class UserModule {}
