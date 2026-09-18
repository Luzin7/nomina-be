import { env } from '@infra/env';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheProvider } from '../contracts/CacheProvider';

@Injectable()
export class RedisService implements CacheProvider, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly isEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isEnabled = env.REDIS_ENABLED ?? false;

    if (this.isEnabled) {
      this.connect();
    } else {
      this.logger.warn('Redis is disabled. Running without cache.');
    }
  }

  private connect(): void {
    try {
      const redisUrl = env.REDIS_URL;
      if (redisUrl) {
        this.client = new Redis(redisUrl, {
          retryStrategy: (times) => Math.min(times * 50, 2000),
        });
      } else {
        this.client = new Redis({
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD,
          db: env.REDIS_DB,
          retryStrategy: (times) => Math.min(times * 50, 2000),
        });
      }

      this.client.on('connect', () => {
        this.logger.log('Redis connected successfully');
      });

      this.client.on('error', (err) => {
        this.logger.error('Redis connection error:', err);
        this.client = null;
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis:', error);
      this.client = null;
    }
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
      this.logger.log('Redis disconnected');
    }
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const response = await this.client.ping();
      return response === 'PONG';
    } catch (error) {
      this.logger.warn('Redis PING failed:', error);
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;

    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.warn(`Redis GET failed for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (!this.client) return false;

    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      this.logger.warn(`Redis SET failed for key ${key}:`, error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      this.logger.warn(`Redis DEL failed for key ${key}:`, error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.warn(`Redis EXISTS failed for key ${key}:`, error);
      return false;
    }
  }

  async acquireLock(key: string, ttlSeconds = 30): Promise<boolean> {
    if (!this.client) return true;

    try {
      const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.warn(`Redis LOCK failed for key ${key}:`, error);
      return true;
    }
  }

  async releaseLock(key: string): Promise<boolean> {
    if (!this.client) return true;

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      this.logger.warn(`Redis UNLOCK failed for key ${key}:`, error);
      return false;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    if (!this.client) return 0;

    try {
      let cursor = '0';
      let deleted = 0;

      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await this.client.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      return deleted;
    } catch (error) {
      this.logger.warn(`Redis SCAN+DEL failed for pattern ${pattern}:`, error);
      return 0;
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isAvailable(): boolean {
    return this.client !== null && this.client.status === 'ready';
  }
}
