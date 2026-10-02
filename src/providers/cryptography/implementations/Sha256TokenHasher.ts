import { createHash } from 'crypto';
import { TokenHasher } from '../contracts/TokenHasher';

export class Sha256TokenHasher implements TokenHasher {
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
