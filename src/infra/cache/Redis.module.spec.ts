import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheProvider } from './contracts/CacheProvider';
import { RedisModule } from './Redis.module';
import { RedisService } from './redis/RedisService';

describe('RedisModule provider wiring', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), RedisModule],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('exposes the RedisService instance through the CacheProvider token', () => {
    expect(moduleRef.get(CacheProvider)).toBe(moduleRef.get(RedisService));
  });
});
