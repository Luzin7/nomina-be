export abstract class RefreshTokenGenerator {
  abstract generate(): string;
  abstract successorOf(rawToken: string): string;
}
