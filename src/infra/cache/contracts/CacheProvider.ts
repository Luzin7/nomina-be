export abstract class CacheProvider {
  abstract get(key: string): Promise<string | null>;
  abstract set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean>;

  abstract del(key: string): Promise<boolean>;
  abstract exists(key: string): Promise<boolean>;
  abstract acquireLock(key: string, ttlSeconds?: number): Promise<boolean>;
  abstract releaseLock(key: string): Promise<boolean>;
  abstract delByPattern(pattern: string): Promise<number>;
}
