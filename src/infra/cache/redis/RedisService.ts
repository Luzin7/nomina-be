import { env } from '@infra/env';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { captureException } from '@sentry/nestjs';
import Redis, { ChainableCommander, RedisOptions } from 'ioredis';
import { CacheProvider, LockHandle } from '../contracts/CacheProvider';
import { RedisUnavailableError } from './errors/RedisUnavailableError';

const COMMAND_TIMEOUT_MS = 2000;
const CONNECT_TIMEOUT_MS = 2000;
const MAX_RETRIES_PER_REQUEST = 1;
const RECONNECT_MIN_DELAY_MS = 50;
const RECONNECT_MAX_DELAY_MS = 2000;
const REPORT_THROTTLE_INTERVAL_MS = 60_000;
const DEFAULT_LOCK_TTL_SECONDS = 30;
export const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

function reconnectDelay(attempt: number): number {
  return Math.min(attempt * RECONNECT_MIN_DELAY_MS, RECONNECT_MAX_DELAY_MS);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class RedisService implements CacheProvider, OnModuleDestroy {
  private static readonly SCAN_BATCH_SIZE = 100;
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private connectionLost = false;
  private readonly lastReportedAt = new Map<string, number>();
  public readonly isEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isEnabled = env.REDIS_ENABLED ?? false;

    if (this.isEnabled) {
      this.connect();
      return;
    }

    this.logger.warn('Redis is disabled. Running without cache.');
  }

  private connect(): void {
    try {
      this.client = this.createClient();
      this.registerHandlers(this.client);
    } catch (error) {
      this.logger.error('Failed to initialize Redis:', error);
      this.client = null;
    }
  }

  private createClient(): Redis {
    const options: RedisOptions = {
      commandTimeout: COMMAND_TIMEOUT_MS,
      connectTimeout: CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
      enableOfflineQueue: false,
      retryStrategy: reconnectDelay,
    };

    const redisUrl = env.REDIS_URL;
    if (redisUrl) return new Redis(redisUrl, options);

    return new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      ...options,
    });
  }

  private registerHandlers(client: Redis): void {
    client.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    client.on('ready', () => {
      this.connectionLost = false;
    });

    client.on('error', (error) => {
      this.connectionLost = true;
      this.logger.error('Redis connection error:', error);
    });
  }

  onModuleDestroy() {
    if (!this.client) return;

    this.client.disconnect();
    this.logger.log('Redis disconnected');
  }

  getClient(): Redis | null {
    if (!this.client) return null;
    // ioredis emits non-fatal errors while the connection stays ready, so a ready status wins.
    if (this.client.status === 'ready') return this.client;
    if (this.connectionLost) return null;

    return this.client;
  }

  isAvailable(): boolean {
    const client = this.getClient();

    return client !== null && client.status === 'ready';
  }

  async ping(): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      const response = await client.ping();
      return response === 'PONG';
    } catch (error) {
      this.logger.warn('Redis PING failed:', error);
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      return await client.get(key);
    } catch (error) {
      this.logger.warn(`Redis GET failed for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      if (ttlSeconds) {
        await client.setex(key, ttlSeconds, value);
      } else {
        await client.set(key, value);
      }
      return true;
    } catch (error) {
      this.logger.warn(`Redis SET failed for key ${key}:`, error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      await client.del(key);
      return true;
    } catch (error) {
      this.logger.warn(`Redis DEL failed for key ${key}:`, error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.warn(`Redis EXISTS failed for key ${key}:`, error);
      return false;
    }
  }

  async acquireLock(
    key: string,
    ttlSeconds = DEFAULT_LOCK_TTL_SECONDS,
  ): Promise<LockHandle | null> {
    const lock: LockHandle = { key, token: randomUUID() };
    if (!this.isEnabled) return lock;

    const client = this.getClient();
    if (!client) {
      this.logger.error(`Redis LOCK unavailable for key ${key}`);
      throw new RedisUnavailableError('Redis client is not available');
    }

    try {
      const result = await client.set(key, lock.token, 'EX', ttlSeconds, 'NX');
      return result === 'OK' ? lock : null;
    } catch (error) {
      this.logger.error(`Redis LOCK failed for key ${key}:`, error);
      throw new RedisUnavailableError(
        `Redis lock command failed: ${errorMessage(error)}`,
      );
    }
  }

  async releaseLock(lock: LockHandle): Promise<boolean> {
    const client = this.getClient();
    if (!client) {
      this.logger.warn(
        `Redis UNLOCK skipped for key ${lock.key}: client is not available`,
      );
      return false;
    }

    try {
      const released = await client.eval(
        RELEASE_LOCK_SCRIPT,
        1,
        lock.key,
        lock.token,
      );
      return Number(released) === 1;
    } catch (error) {
      this.logger.warn(`Redis UNLOCK failed for key ${lock.key}:`, error);
      return false;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    const client = this.getClient();
    if (!client) {
      this.reportUnavailable('delByPattern', `UNLINK by pattern "${pattern}"`, {
        'cache.pattern': pattern,
      });
      return 0;
    }

    let totalDeleted = 0;
    let failedKeys = 0;
    let firstFailure: unknown = null;

    try {
      const stream = client.scanStream({
        match: pattern,
        count: RedisService.SCAN_BATCH_SIZE,
      });

      for await (const keys of stream) {
        if (keys.length === 0) continue;

        const pipeline = client.pipeline();
        keys.forEach((key: string) => pipeline.unlink(key));
        const results = (await pipeline.exec()) ?? [];

        for (const [error] of results) {
          if (!error) {
            totalDeleted++;
            continue;
          }
          failedKeys++;
          firstFailure ??= error;
        }
      }
    } catch (error) {
      firstFailure ??= error;
    }

    if (firstFailure)
      this.reportPatternFailure(firstFailure, pattern, failedKeys);

    return totalDeleted;
  }

  async readCounter(key: string, initialValue: number): Promise<number | null> {
    return this.runCounterTransaction('readCounter', key, initialValue, (tx) =>
      tx.get(key),
    );
  }

  async incrementCounter(
    key: string,
    initialValue: number,
  ): Promise<number | null> {
    return this.runCounterTransaction(
      'incrementCounter',
      key,
      initialValue,
      (tx) => tx.incr(key),
    );
  }

  private async runCounterTransaction(
    operation: string,
    key: string,
    initialValue: number,
    addResultCommand: (transaction: ChainableCommander) => ChainableCommander,
  ): Promise<number | null> {
    const tags = { 'cache.op': operation, 'cache.key': key };
    const client = this.getClient();
    if (!client) {
      this.reportUnavailable(operation, operation, tags);
      return null;
    }

    try {
      const transaction = client.multi().set(key, initialValue, 'NX');
      const results = await addResultCommand(transaction).exec();
      if (!results) throw new Error(`Redis ${operation} transaction aborted`);

      const failed = results.find(([commandError]) => commandError);
      if (failed) throw failed[0];

      return Number(results[1][1]);
    } catch (error) {
      this.logger.warn(
        `Redis ${operation} failed for key ${key}: ${errorMessage(error)}`,
      );
      this.captureThrottled(`${operation}:failed`, error, { tags });
      return null;
    }
  }

  private reportUnavailable(
    operationKind: string,
    description: string,
    tags: Record<string, string>,
  ): void {
    if (!this.isEnabled) return;

    this.logger.warn(`Redis unavailable for ${description}`);
    this.captureThrottled(
      `${operationKind}:unavailable`,
      new RedisUnavailableError(
        `Redis client is not available for ${description}`,
      ),
      { tags },
    );
  }

  private captureThrottled(
    throttleKey: string,
    error: unknown,
    context: Parameters<typeof captureException>[1],
  ): void {
    const now = Date.now();
    const lastReportedAt = this.lastReportedAt.get(throttleKey);
    if (
      lastReportedAt !== undefined &&
      now - lastReportedAt < REPORT_THROTTLE_INTERVAL_MS
    ) {
      return;
    }

    this.lastReportedAt.set(throttleKey, now);
    captureException(error, context);
  }

  private reportPatternFailure(
    error: unknown,
    pattern: string,
    failedKeys: number,
  ): void {
    this.logger.warn(
      `Redis scan/unlink failed for pattern "${pattern}" (failedKeys=${failedKeys}): ${errorMessage(error)}`,
    );
    this.captureThrottled('delByPattern:failed', error, {
      tags: { 'cache.pattern': pattern },
      ...(failedKeys > 0 && { extra: { failedKeys } }),
    });
  }
}
