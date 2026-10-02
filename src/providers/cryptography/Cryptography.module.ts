import { Module } from '@nestjs/common';
import { Decoder } from './contracts/Decoder';
import { Encrypter } from './contracts/Encrypter';
import { HandleHashGenerator } from './contracts/HandleHashGenerator';
import { HashComparer } from './contracts/HashComparer';
import { HashGenerator } from './contracts/HashGenerator';
import { TokenHasher } from './contracts/TokenHasher';
import { BcryptHasher } from './implementations/BcryptHasher';
import { CryptoHasher } from './implementations/CryptoHasher';
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
  ],
  exports: [
    Encrypter,
    HashComparer,
    HashGenerator,
    Decoder,
    HandleHashGenerator,
    TokenHasher,
  ],
})
export class CryptographyModule {}
