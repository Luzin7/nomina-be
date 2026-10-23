import { env } from '@infra/env';
import { Module } from '@nestjs/common';
import { Decoder } from './contracts/Decoder';
import { Encrypter } from './contracts/Encrypter';
import { HandleHashGenerator } from './contracts/HandleHashGenerator';
import { HashComparer } from './contracts/HashComparer';
import { HashGenerator } from './contracts/HashGenerator';
import { RefreshTokenGenerator } from './contracts/RefreshTokenGenerator';
import { TokenHasher } from './contracts/TokenHasher';
import { BcryptHasher } from './implementations/BcryptHasher';
import { CryptoHasher } from './implementations/CryptoHasher';
import { HmacRefreshTokenGenerator } from './implementations/HmacRefreshTokenGenerator';
import { JwtEncrypter } from './implementations/jwtEncrypter';
import { Sha256TokenHasher } from './implementations/Sha256TokenHasher';

@Module({
  providers: [
    { provide: Encrypter, useClass: JwtEncrypter },
    { provide: Decoder, useClass: JwtEncrypter },
    { provide: HashComparer, useClass: BcryptHasher },
    { provide: HashGenerator, useClass: BcryptHasher },
    { provide: HandleHashGenerator, useClass: CryptoHasher },
    { provide: TokenHasher, useClass: Sha256TokenHasher },
    {
      provide: RefreshTokenGenerator,
      useFactory: () => new HmacRefreshTokenGenerator(env.JWT_PRIVATE_KEY),
    },
  ],
  exports: [
    Encrypter,
    HashComparer,
    HashGenerator,
    Decoder,
    HandleHashGenerator,
    TokenHasher,
    RefreshTokenGenerator,
  ],
})
export class CryptographyModule {}
