import { Injectable } from '@nestjs/common';
import { JwtService, JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';
import { Decoder } from '../contracts/Decoder';
import { Encrypter } from '../contracts/Encrypter';

@Injectable()
export class JwtEncrypter implements Encrypter, Decoder {
  private static readonly DEFAULT_SIGN_OPTIONS: JwtSignOptions = {
    algorithm: 'RS256',
  };

  constructor(private readonly jwtService: JwtService) {}

  async encrypt(
    payload: Record<string, unknown>,
    options: JwtSignOptions = JwtEncrypter.DEFAULT_SIGN_OPTIONS,
  ): Promise<string> {
    return await this.jwtService.signAsync(payload, options);
  }

  async decrypt(
    token: string,
    options: JwtVerifyOptions = {},
  ): Promise<{ payload?: Record<string, unknown>; isValid: boolean }> {
    try {
      const payload = await this.jwtService.verifyAsync(token, options);

      return { payload, isValid: true };
    } catch {
      return { isValid: false };
    }
  }
}
