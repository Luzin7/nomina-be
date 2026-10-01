import { Global, Module } from '@nestjs/common';
import { CacheProvider } from './contracts/CacheProvider';
import { RedisService } from './redis/RedisService';

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: CacheProvider,
      useClass: RedisService,
    },
  ],
  exports: [RedisService, CacheProvider],
})
export class RedisModule {}
