import { JwtVerifyOptions } from '@nestjs/jwt';

export abstract class Decoder {
  abstract decrypt(
    token: string,
    options?: JwtVerifyOptions,
  ): Promise<{ payload?: Record<string, unknown>; isValid: boolean }>;
}
