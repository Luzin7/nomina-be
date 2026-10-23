import { RATE_LIMITS } from '@constants/rateLimits';
import { RedisService } from '@infra/cache/redis/RedisService';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { HealthController } from '@infra/http/healthCheck.controller';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import { JwtAuthGuard } from '@providers/auth/guards/jwtAuth.guard';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { right } from '@shared/core/errors/Either';
import request from 'supertest';
import { clearInternalKeyMismatchThrottle } from './trackers';
import { CreateUserController } from '@modules/user/features/create-user/create-user.controller';
import { CreateUserService } from '@modules/user/features/create-user/create-user.service';
import { LoginUserController } from '@modules/user/features/login-user/login-user.controller';
import { LoginUserService } from '@modules/user/features/login-user/login-user.service';
import { LogoutUserController } from '@modules/user/features/logout-user/logout-user.controller';
import { LogoutUserService } from '@modules/user/features/logout-user/logout-user.service';
import { RefreshTokenController } from '@modules/user/features/refresh-token/refresh-token.controller';
import { RefreshTokenService } from '@modules/user/features/refresh-token/refresh-token.service';
import { APP_GUARDS, AppThrottlerGuard } from './AppThrottler.guard';
import { CLIENT_IP_HEADER, INTERNAL_KEY_HEADER } from './client-ip';
import { buildRateLimitOptions } from './rate-limit.options';

const internalKey = 'k'.repeat(32);
const TEST_USER_HEADER = 'x-test-user';

class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const sub = req.headers[TEST_USER_HEADER];

    if (sub) req.user = { sub };

    return true;
  }
}

@Controller('stub')
class StubAuthenticatedController {
  @Get('a')
  routeA() {
    return { ok: true };
  }

  @Get('b')
  routeB() {
    return { ok: true };
  }
}

class RecordingStorage extends ThrottlerStorageService {
  readonly keys = new Set<string>();

  async increment(...args: Parameters<ThrottlerStorageService['increment']>) {
    this.keys.add(args[0]);
    return super.increment(...args);
  }
}

const sessionServiceStub = {
  execute: jest
    .fn()
    .mockResolvedValue(
      right({ accessToken: 'access', refreshToken: 'refresh' }),
    ),
};
const voidServiceStub = { execute: jest.fn().mockResolvedValue(right(null)) };

async function buildApp(storage = new RecordingStorage()) {
  const guards = APP_GUARDS.filter(
    (guard) => guard.useClass !== RolesGuard,
  ).map((guard) =>
    guard.useClass === JwtAuthGuard
      ? { ...guard, useClass: StubAuthGuard }
      : guard,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({
        ...buildRateLimitOptions({
          enforce: true,
          internalKeys: [internalKey],
        }),
        storage,
      }),
    ],
    controllers: [
      StubAuthenticatedController,
      LoginUserController,
      CreateUserController,
      RefreshTokenController,
      LogoutUserController,
      HealthController,
    ],
    providers: [
      ...guards,
      { provide: LoginUserService, useValue: sessionServiceStub },
      { provide: RefreshTokenService, useValue: sessionServiceStub },
      { provide: CreateUserService, useValue: voidServiceStub },
      { provide: LogoutUserService, useValue: voidServiceStub },
      { provide: DrizzleService, useValue: {} },
      { provide: RedisService, useValue: {} },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, storage };
}

function clientHeaders(ip: string) {
  return { [CLIENT_IP_HEADER]: ip, [INTERNAL_KEY_HEADER]: internalKey };
}

function clientIp(index: number) {
  return `203.0.113.${index}`;
}

describe('rate limiting', () => {
  let app: INestApplication;
  let storage: RecordingStorage;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeEach(async () => {
    ({ app, storage } = await buildApp());
    server = app.getHttpServer();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  const login = (email: string, ip: string) =>
    request(server)
      .post('/auth/login')
      .set(clientHeaders(ip))
      .send({ email, password: 'password-1' });

  const createUser = (email: string, ip: string) =>
    request(server)
      .post('/user')
      .set(clientHeaders(ip))
      .send({ name: 'Maria Silva', email, password: 'password-1' });

  const refresh = (token: string, ip: string) =>
    request(server)
      .post('/auth/session/refresh')
      .set(clientHeaders(ip))
      .set('Cookie', `refresh_token=${token}`);

  const asUser = (sub: string, path = '/stub/a') =>
    request(server).get(path).set(TEST_USER_HEADER, sub);

  async function exhaust(limit: number, send: (index: number) => request.Test) {
    for (let index = 0; index < limit; index++) {
      const response = await send(index);
      expect(response.status).toBeLessThan(400);
    }
  }

  it('two users behind the same ip keep separate buckets', async () => {
    await exhaust(RATE_LIMITS.user.limit, () => asUser('user-a'));

    expect((await asUser('user-a')).status).toBe(429);
    expect((await asUser('user-b')).status).toBe(200);
  });

  it('one user is limited across routes', async () => {
    const half = RATE_LIMITS.user.limit / 2;
    await exhaust(half, () => asUser('user-a', '/stub/a'));
    await exhaust(half, () => asUser('user-a', '/stub/b'));

    expect((await asUser('user-a', '/stub/a')).status).toBe(429);
  });

  it('authenticated routes ignore the login limit', async () => {
    await exhaust(RATE_LIMITS.client.login.limit + 5, () => asUser('user-a'));
  });

  it('login is limited per account across client ips', async () => {
    await exhaust(RATE_LIMITS.account.login.limit, (index) =>
      login('maria@example.com', clientIp(index)),
    );

    const response = await login('maria@example.com', clientIp(200));

    expect(response.status).toBe(429);
  });

  it('login is limited per client ip across accounts', async () => {
    await exhaust(RATE_LIMITS.client.login.limit, (index) =>
      login(`user${index}@example.com`, clientIp(1)),
    );

    const response = await login('another@example.com', clientIp(1));

    expect(response.status).toBe(429);
  });

  it('login normalizes email case and spaces for the account limit', async () => {
    await exhaust(RATE_LIMITS.account.login.limit, (index) =>
      login(
        index % 2 ? ' MARIA@example.com ' : 'maria@example.com',
        clientIp(index),
      ),
    );

    const response = await login('Maria@Example.com', clientIp(200));

    expect(response.status).toBe(429);
  });

  it('forwarded client ip without the internal key falls into the direct bucket', async () => {
    const withoutKey = (index: number) =>
      request(server)
        .post('/auth/login')
        .set(CLIENT_IP_HEADER, clientIp(index))
        .send({ email: `user${index}@example.com`, password: 'password-1' });

    await exhaust(RATE_LIMITS.client.login.limit, withoutKey);

    expect((await withoutKey(100)).status).toBe(429);
  });

  it('create-user is limited per account and per client ip', async () => {
    await exhaust(RATE_LIMITS.account.createUser.limit, (index) =>
      createUser('maria@example.com', clientIp(index)),
    );
    expect((await createUser('maria@example.com', clientIp(200))).status).toBe(
      429,
    );

    await exhaust(RATE_LIMITS.client.createUser.limit, (index) =>
      createUser(`user${index}@example.com`, clientIp(250)),
    );
    expect(
      (await createUser('another@example.com', clientIp(250))).status,
    ).toBe(429);
  });

  it('refresh is limited per presented token', async () => {
    await exhaust(RATE_LIMITS.refreshToken.limit, (index) =>
      refresh('token-a', clientIp(index)),
    );

    expect((await refresh('token-a', clientIp(200))).status).toBe(429);
    expect((await refresh('token-b', clientIp(200))).status).toBe(200);
  });

  it('refresh with different tokens from one client keeps separate token buckets', async () => {
    await exhaust(RATE_LIMITS.refreshToken.limit + 1, (index) =>
      refresh(`token-${index}`, clientIp(1)),
    );
  });

  it('blocked client does not create token buckets', async () => {
    await exhaust(RATE_LIMITS.client.login.limit, (index) =>
      login(`user${index}@example.com`, clientIp(1)),
    );
    const accountKeysBefore = [...storage.keys].filter((key) =>
      key.startsWith('account:'),
    );

    const response = await login('blocked@example.com', clientIp(1));
    const accountKeysAfter = [...storage.keys].filter((key) =>
      key.startsWith('account:'),
    );

    expect(response.status).toBe(429);
    expect(accountKeysAfter).toEqual(accountKeysBefore);
  });

  it('health liveness is never throttled', async () => {
    await exhaust(RATE_LIMITS.client.default.limit + 10, () =>
      request(server).get('/health'),
    );
  });

  it('rejection log has category and key reference without email, ip or token', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await exhaust(RATE_LIMITS.account.login.limit, (index) =>
      login('maria@example.com', clientIp(index)),
    );
    await login('maria@example.com', '198.51.100.77');

    const message = String(warn.mock.calls.at(-1)?.[0]);

    expect(message).toMatch(/category=account/);
    expect(message).toMatch(/route=LoginUserController\.handle/);
    expect(message).toMatch(/key=[0-9a-f]{12}(\s|$)/);
    expect(message).not.toMatch(/maria|example\.com|198\.51|203\.0/);
  });

  it('rejection log tells the client ip source', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await exhaust(RATE_LIMITS.client.login.limit, (index) =>
      login(`user${index}@example.com`, clientIp(1)),
    );
    await login('another@example.com', clientIp(1));

    expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(
      /category=client ipSource=internal/,
    );
  });

  it('rejection sets Retry-After', async () => {
    await exhaust(RATE_LIMITS.client.login.limit, (index) =>
      login(`user${index}@example.com`, clientIp(1)),
    );

    const response = await login('another@example.com', clientIp(1));

    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('authentication runs before rate limiting', () => {
    expect(APP_GUARDS.map((guard) => guard.useClass)).toEqual([
      JwtAuthGuard,
      AppThrottlerGuard,
      RolesGuard,
    ]);
  });

  it('logs an internal key mismatch at most once per minute without the key value', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const now = jest.spyOn(Date, 'now');
    const wrongKey = 'w'.repeat(32);
    const send = () =>
      request(server)
        .post('/auth/logout')
        .set({
          [CLIENT_IP_HEADER]: clientIp(1),
          [INTERNAL_KEY_HEADER]: wrongKey,
        });

    clearInternalKeyMismatchThrottle();
    now.mockReturnValue(1_000_000);
    await send();
    await send();
    const mismatches = () =>
      warn.mock.calls.filter(([message]) =>
        String(message).includes('internal key mismatch'),
      );

    expect(mismatches()).toHaveLength(1);
    expect(String(mismatches()[0][0])).not.toContain(wrongKey);

    now.mockReturnValue(1_000_000 + 61_000);
    await send();

    expect(mismatches()).toHaveLength(2);
  });
});

describe('throttler storage', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("should not keep an idle key blocked after another key's block resets", async () => {
    jest.useFakeTimers();
    const storage = new ThrottlerStorageService();
    const ttl = 1_000;
    const limit = 2;
    const hit = (key: string) =>
      storage.increment(key, ttl, limit, ttl, 'client');
    for (let attempt = 0; attempt <= limit; attempt++) await hit('key-a');
    jest.advanceTimersByTime(ttl - 100);
    await hit('key-b');
    await hit('key-b');
    jest.advanceTimersByTime(110);
    await hit('key-a');
    jest.advanceTimersByTime(3 * ttl);

    const record = await hit('key-b');

    expect(record.isBlocked).toBe(false);
    storage.onApplicationShutdown();
  });
});
