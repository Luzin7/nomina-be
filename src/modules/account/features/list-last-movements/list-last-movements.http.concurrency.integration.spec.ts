import { TransactionStatus, TransactionType, UserRole } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RedisService } from '@infra/cache/redis/RedisService';
import { RedisModule } from '@infra/cache/Redis.module';
import { DatabaseModule } from '@infra/databases/Database.module';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { AccountModule } from '@modules/account/Account.module';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  insertLastMovement,
  seedLastMovements,
} from '@modules/account/test-helpers/last-movements-seed';
import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DateModule } from '@providers/date/Date.module';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import {
  PostgresHandle,
  startPostgres,
} from '@shared/cache/test-helpers/freshness-harness';
import type { Request, RequestHandler } from 'express';
import request from 'supertest';

jest.setTimeout(180_000);

let postgres: PostgresHandle;

const attachWorkspace = (context: { workspaceId: string }): RequestHandler => {
  const middleware: RequestHandler = (req, _res, next) => {
    (req as Request & { user: unknown }).user = {
      workspaceId: context.workspaceId,
      sub: 'member-1',
      role: UserRole.OWNER,
    };
    next();
  };

  return middleware;
};

describe('GET /account/last-movements over HTTP', () => {
  const apps: INestApplication[] = [];
  const closeSpies = new Map<INestApplication, jest.SpyInstance>();

  beforeAll(async () => {
    postgres = await startPostgres();
  });

  afterEach(async () => {
    const opened = apps.splice(0);
    await Promise.all(opened.map((app) => app.close()));

    opened.forEach((app) => {
      expect(closeSpies.get(app)).toHaveBeenCalledTimes(1);
    });
    closeSpies.clear();
  });

  afterAll(async () => {
    await postgres?.stop();
  });

  const bootApp = async (context: {
    workspaceId: string;
  }): Promise<INestApplication> => {
    expect(apps).toHaveLength(0);

    const cache = new InMemoryCacheProvider();
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ global: true, secret: 'last-movements-test' }),
        DatabaseModule,
        RedisModule,
        DateModule,
        AccountModule,
      ],
    })
      .overrideProvider(DRIZZLE_TOKEN)
      .useValue(postgres.db)
      .overrideProvider(CacheProvider)
      .useValue(cache)
      .overrideProvider(RedisService)
      .useValue(cache)
      .compile();

    const app = moduleRef.createNestApplication();
    app.use(attachWorkspace(context));
    await app.init();

    apps.push(app);
    closeSpies.set(app, jest.spyOn(app, 'close'));

    return app;
  };

  const seedWithApp = async (timezone: string) => {
    const context = { workspaceId: '' };
    const app = await bootApp(context);
    const seed = await seedLastMovements({ app, db: postgres.db }, timezone);
    context.workspaceId = seed.workspaceId;

    return { app, seed };
  };

  it('answers 200 with one ISO date per account, transfers included', async () => {
    const { app, seed } = await seedWithApp('America/Sao_Paulo');

    await insertLastMovement(postgres.db, seed, { title: 'Mercado' });
    await insertLastMovement(postgres.db, seed, {
      title: 'Transferência',
      type: TransactionType.TRANSFER,
      destinationAccountId: seed.destinationAccountId,
      date: new Date('2026-11-22T15:00:00.000Z'),
    });
    await insertLastMovement(postgres.db, seed, {
      accountId: seed.pendingAccountId,
      title: 'Pendente',
      status: TransactionStatus.PENDING,
      date: new Date('2026-11-23T15:00:00.000Z'),
    });

    const response = await request(app.getHttpServer()).get(
      '/account/last-movements',
    );

    expect(response.status).toBe(200);
    expect(response.body.data.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: seed.accountId,
          title: 'Transferência',
          date: '2026-11-22T15:00:00.000Z',
        }),
        expect.objectContaining({
          accountId: seed.destinationAccountId,
          title: 'Transferência',
          date: '2026-11-22T15:00:00.000Z',
        }),
      ]),
    );
    expect(response.body.data.movements).toHaveLength(2);
  });

  it('answers 200 with an empty list when the workspace has no movements', async () => {
    const { app } = await seedWithApp('UTC');

    const response = await request(app.getHttpServer()).get(
      '/account/last-movements',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { movements: [] } });
  });

  it('serves the warm cache with the same ISO dates', async () => {
    const { app, seed } = await seedWithApp('America/Sao_Paulo');
    const repository = app.get(AccountRepository);

    await insertLastMovement(postgres.db, seed, { title: 'Mercado' });

    const readLastMovements = jest.spyOn(
      repository,
      'findLastMovementsByWorkspaceId',
    );
    const http = app.getHttpServer();

    const cold = await request(http).get('/account/last-movements');
    const warm = await request(http).get('/account/last-movements');

    expect(cold.status).toBe(200);
    expect(warm.status).toBe(200);
    expect(cold.body.data.movements[0].date).toBe('2026-11-10T15:00:00.000Z');
    expect(warm.body).toEqual(cold.body);
    expect(readLastMovements).toHaveBeenCalledTimes(1);
  });
});
