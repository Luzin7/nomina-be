import { RedisService } from '@infra/cache/redis/RedisService';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { env } from '@infra/env';
import { SkipAllRateLimits } from './throttling/decorators';
import {
  Controller,
  Get,
  HttpCode,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '@providers/auth/decorators/IsPublic.decorator';
import { statusCode } from '@shared/core/types/statusCode';
import { sql } from 'drizzle-orm';

@Controller('health')
export class HealthController {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly redisService: RedisService,
  ) {}

  @Public()
  @SkipAllRateLimits()
  @Get()
  @HttpCode(statusCode.OK)
  checkLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: env.APP_VERSION || null,
      commit: env.GIT_SHA || null,
    };
  }

  @Public()
  @SkipAllRateLimits()
  @Get('ready')
  @HttpCode(statusCode.OK)
  async checkReadiness() {
    try {
      await this.drizzle.db.execute(sql`SELECT 1`);

      if (env.REDIS_ENABLED) {
        const isRedisAwake = await this.redisService.ping();
        if (!isRedisAwake) {
          throw new Error('Redis ping failed');
        }
      }

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: env.APP_VERSION || null,
        commit: env.GIT_SHA || null,
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        message: 'Infrastructure dependencies are unavailable',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
