import {
  CacheProvider,
  LockHandle,
} from '@infra/cache/contracts/CacheProvider';

export class InMemoryCacheProvider implements CacheProvider {
  readonly isEnabled = true;
  readonly counters = new Map<string, number>();
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    this.values.set(key, value);
    if (ttlSeconds !== undefined) this.ttls.set(key, ttlSeconds);
    return true;
  }

  async del(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.values.has(key);
  }

  async acquireLock(key: string): Promise<LockHandle | null> {
    return { key, token: 'in-memory' };
  }

  async releaseLock(): Promise<boolean> {
    return true;
  }

  async delByPattern(): Promise<number> {
    return 0;
  }

  async readCounter(key: string, initialValue: number): Promise<number> {
    if (!this.counters.has(key)) this.counters.set(key, initialValue);
    return this.counters.get(key) as number;
  }

  async incrementCounter(key: string, initialValue: number): Promise<number> {
    const next = (this.counters.get(key) ?? initialValue) + 1;
    this.counters.set(key, next);
    return next;
  }
}
