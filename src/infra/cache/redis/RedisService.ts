import { env } from '@infra/env';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { CacheProvider } from '../contracts/CacheProvider';
import { RedisUnavailableError } from './errors/RedisUnavailableError';

const COMMAND_TIMEOUT_MS = 2000;
const CONNECT_TIMEOUT_MS = 2000;
const MAX_RETRIES_PER_REQUEST = 1;
const RECONNECT_MIN_DELAY_MS = 50;
const RECONNECT_MAX_DELAY_MS = 2000;
const DEFAULT_LOCK_TTL_SECONDS = 30;

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
  ): Promise<boolean> {
    if (!this.isEnabled) return true;

    const client = this.getClient();
    if (!client) {
      this.logger.error(`Redis LOCK unavailable for key ${key}`);
      throw new RedisUnavailableError('Redis client is not available');
    }

    try {
      const result = await client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Redis LOCK failed for key ${key}:`, error);
      throw new RedisUnavailableError(
        `Redis lock command failed: ${errorMessage(error)}`,
      );
    }
  }

  async releaseLock(key: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) {
      this.logger.warn(
        `Redis UNLOCK skipped for key ${key}: client is not available`,
      );
      return false;
    }

    try {
      await client.del(key);
      return true;
    } catch (error) {
      this.logger.warn(`Redis UNLOCK failed for key ${key}:`, error);
      return false;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    const client = this.getClient();
    if (!client) return 0;

    try {
      let totalDeleted = 0;
      const stream = client.scanStream({
        match: pattern,
        count: RedisService.SCAN_BATCH_SIZE,
      });

      for await (const keys of stream) {
        if (keys.length > 0) {
          const pipeline = client.pipeline();
          keys.forEach((key: string) => pipeline.unlink(key));
          await pipeline.exec();
          totalDeleted += keys.length;
        }
      }

      return totalDeleted;
    } catch (error) {
      this.logger.warn(
        `Redis scanStream/unlink failed for pattern "${pattern}":`,
        error,
      );
      return 0;
    }
  }
}
