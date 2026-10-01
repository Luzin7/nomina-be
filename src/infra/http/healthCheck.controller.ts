import { RedisService } from '@infra/cache/redis/RedisService';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
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
  @Get()
  @HttpCode(statusCode.OK)
  checkLiveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  @HttpCode(statusCode.OK)
  async checkReadiness() {
    try {
      await this.drizzle.db.execute(sql`SELECT 1`);

      const isRedisEnabled = process.env.REDIS_ENABLED === 'true';
      if (isRedisEnabled) {
        const isRedisAwake = await this.redisService.ping();
        if (!isRedisAwake) {
          throw new Error('Redis ping failed');
        }
      }

      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        message: 'Infrastructure dependencies are unavailable',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
