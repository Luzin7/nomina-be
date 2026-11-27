import { UserRole } from '@constants/enums';
import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { right } from '@shared/core/errors/Either';
import type { Request, RequestHandler } from 'express';
import request from 'supertest';
import { AccountModule } from './Account.module';
import { FindAccountController } from './features/find-account/find-account.controller';
import { FindAccountByIdService } from './features/find-account/find-account.handler';
import { ListLastMovementsController } from './features/list-last-movements/list-last-movements.controller';
import { ListLastMovementsService } from './features/list-last-movements/list-last-movements.handler';

const registeredControllers = (): Type<unknown>[] =>
  Reflect.getMetadata('controllers', AccountModule) as Type<unknown>[];

const movementControllers = (): Type<unknown>[] => {
  const controllers = registeredControllers();

  return [ListLastMovementsController, FindAccountController].sort(
    (a, b) => controllers.indexOf(a) - controllers.indexOf(b),
  );
};

const attachUser: RequestHandler = (req, _res, next) => {
  (req as Request & { user: unknown }).user = {
    workspaceId: 'ws-1',
    role: UserRole.OWNER,
  };
  next();
};

describe('account static routes', () => {
  it('registers the last movements controller before the param route', () => {
    const controllers = registeredControllers();

    expect(controllers).toContain(ListLastMovementsController);
    expect(controllers).toContain(FindAccountController);
    expect(controllers.indexOf(ListLastMovementsController)).toBeLessThan(
      controllers.indexOf(FindAccountController),
    );
  });

  it('serves the last movements route with 200', async () => {
    const findAccount = { execute: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: movementControllers(),
      providers: [
        {
          provide: ListLastMovementsService,
          useValue: {
            execute: jest.fn().mockResolvedValue(right({ movements: [] })),
          },
        },
        { provide: FindAccountByIdService, useValue: findAccount },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.use(attachUser);
    await app.init();

    const response = await request(app.getHttpServer()).get(
      '/account/last-movements',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { movements: [] } });
    expect(findAccount.execute).not.toHaveBeenCalled();

    await app.close();
  });
});
