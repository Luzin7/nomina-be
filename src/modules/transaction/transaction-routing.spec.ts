import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { right } from '@shared/core/errors/Either';
import type { Request, RequestHandler } from 'express';
import request from 'supertest';
import { FindRecurringTransactionController } from './features/find-recurring-transaction/find-recurring-transaction.controller';
import { FindRecurringTransactionService } from './features/find-recurring-transaction/find-recurring-transaction.service';
import { RecurringSummaryController } from './features/recurring-summary/recurring-summary.controller';
import { RecurringSummaryService } from './features/recurring-summary/recurring-summary.service';
import { TransactionModule } from './Transaction.module';

const SUMMARY = {
  monthlyEquivalentCents: 0,
  activeCount: 0,
  pausedCount: 0,
  exhaustedCount: 0,
  materializedThisMonthCents: 0,
  stillToComeThisMonthCents: 0,
  next30Days: [],
  byFrequency: [],
};

const registeredControllers = (): Type<unknown>[] =>
  Reflect.getMetadata('controllers', TransactionModule) as Type<unknown>[];

const recurringControllers = (): Type<unknown>[] => {
  const controllers = registeredControllers();

  return [RecurringSummaryController, FindRecurringTransactionController].sort(
    (a, b) => controllers.indexOf(a) - controllers.indexOf(b),
  );
};

const attachUser: RequestHandler = (req, _res, next) => {
  (req as Request & { user: unknown }).user = { workspaceId: 'ws-1' };
  next();
};

describe('recurring routes', () => {
  it('registers the summary controller before the param route', () => {
    const controllers = registeredControllers();

    expect(controllers).toContain(RecurringSummaryController);
    expect(controllers).toContain(FindRecurringTransactionController);
    expect(controllers.indexOf(RecurringSummaryController)).toBeLessThan(
      controllers.indexOf(FindRecurringTransactionController),
    );
  });

  it('serves the static summary route with 200', async () => {
    const findRecurring = { execute: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: recurringControllers(),
      providers: [
        {
          provide: RecurringSummaryService,
          useValue: { execute: jest.fn().mockResolvedValue(right(SUMMARY)) },
        },
        { provide: FindRecurringTransactionService, useValue: findRecurring },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.use(attachUser);
    await app.init();

    const response = await request(app.getHttpServer()).get(
      '/transaction/recurring/summary',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: SUMMARY });
    expect(findRecurring.execute).not.toHaveBeenCalled();

    await app.close();
  });
});
