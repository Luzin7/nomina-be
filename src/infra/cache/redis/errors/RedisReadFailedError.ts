export class RedisReadFailedError extends Error {
  constructor(
    readonly key: string,
    cause?: unknown,
  ) {
    super(`Redis GET failed for key ${key}`, { cause });
    this.name = 'RedisReadFailedError';
  }
}
