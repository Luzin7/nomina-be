import { AccountType, UserRole } from '@constants/enums';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '@providers/auth/decorators/Roles.decorator';
import type { Request, RequestHandler } from 'express';
import request from 'supertest';
import { FindAccountController } from './find-account.controller';
import { FindAccountByIdService } from './find-account.handler';

const ACCOUNT_ID = '123e4567-e89b-12d3-a456-426614174000';
const WORKSPACE_ID = 'ws-1';

const attachUser: RequestHandler = (req, _res, next) => {
  (req as Request & { user: unknown }).user = { workspaceId: WORKSPACE_ID };
  next();
};

describe('FindAccountController', () => {
  let app: INestApplication;
  let accountRepository: jest.Mocked<AccountRepository>;

  beforeEach(async () => {
    accountRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<AccountRepository>;

    const moduleRef = await Test.createTestingModule({
      controllers: [FindAccountController],
      providers: [
        FindAccountByIdService,
        { provide: AccountRepository, useValue: accountRepository },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(attachUser);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers no guard of its own', () => {
    expect(
      Reflect.getMetadata('__guards__', FindAccountController),
    ).toBeUndefined();
  });

  it('allows owner, admin, user and viewer', () => {
    expect(Reflect.getMetadata(ROLES_KEY, FindAccountController)).toEqual([
      UserRole.OWNER,
      UserRole.ADMIN,
      UserRole.USER,
      UserRole.VIEWER,
    ]);
  });

  it('answers 200 with the account for a same-workspace member', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCheckingAccount({ id: ACCOUNT_ID }),
    );

    const response = await request(app.getHttpServer()).get(
      `/account/${ACCOUNT_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: {
        id: ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
        type: AccountType.CHECKING,
      },
    });
  });

  it('answers 403 for an account of a foreign workspace', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCheckingAccount({ id: ACCOUNT_ID, workspaceId: 'ws-2' }),
    );

    const response = await request(app.getHttpServer()).get(
      `/account/${ACCOUNT_ID}`,
    );

    expect(response.status).toBe(403);
  });

  it('answers 403 for an unknown account', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const response = await request(app.getHttpServer()).get(
      `/account/${ACCOUNT_ID}`,
    );

    expect(response.status).toBe(403);
  });

  it('answers 400 for a non-UUID id before reaching the handler', async () => {
    const response = await request(app.getHttpServer()).get(
      '/account/not-a-uuid',
    );

    expect(response.status).toBe(400);
    expect(accountRepository.findById).not.toHaveBeenCalled();
  });
});
