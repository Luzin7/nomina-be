export interface LockHandle {
  readonly key: string;
  readonly token: string;
}

export abstract class CacheProvider {
  abstract readonly isEnabled: boolean;

  abstract get(key: string): Promise<string | null>;
  abstract set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean>;

  abstract del(key: string): Promise<boolean>;
  abstract exists(key: string): Promise<boolean>;
  abstract acquireLock(
    key: string,
    ttlSeconds?: number,
  ): Promise<LockHandle | null>;

  abstract releaseLock(lock: LockHandle): Promise<boolean>;
  abstract delByPattern(pattern: string): Promise<number>;
}
