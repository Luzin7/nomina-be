import { UserRole } from '@constants/enums';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '@providers/auth/decorators/Roles.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { right } from '@shared/core/errors/Either';
import type { Request, RequestHandler } from 'express';
import request from 'supertest';
import { UpdateWorkspaceController } from './update-workspace.controller';
import { UpdateWorkspaceService } from './update-workspace.service';

const WORKSPACE_ID = '7f1d1f4e-52a0-4d0c-9a53-1c3f0d6f8a11';
const USER = {
  sub: 'user-1',
  workspaceId: WORKSPACE_ID,
  role: UserRole.OWNER,
} as TokenPayloadSchema;

const attachUser: RequestHandler = (req, _res, next) => {
  (req as Request & { user: unknown }).user = USER;
  next();
};

function makeWorkspace(): Workspace {
  const r = Workspace.create({ name: 'New Name' }, WORKSPACE_ID);
  if (r.isLeft()) throw r.value;
  return r.value;
}

describe('UpdateWorkspaceController', () => {
  let app: INestApplication;
  let service: jest.Mocked<UpdateWorkspaceService>;

  beforeEach(async () => {
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<UpdateWorkspaceService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [UpdateWorkspaceController],
      providers: [{ provide: UpdateWorkspaceService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(attachUser);
    await app.init();
  });

  afterEach(() => app.close());

  it('requires OWNER and ADMIN at the route metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UpdateWorkspaceController)).toEqual([
      UserRole.OWNER,
      UserRole.ADMIN,
    ]);
  });

  it('passes the authenticated user sub to the service', async () => {
    service.execute.mockResolvedValue(right(makeWorkspace()));

    const response = await request(app.getHttpServer())
      .put(`/workspace/${WORKSPACE_ID}`)
      .send({ name: 'New Name' });

    expect(response.status).toBe(200);
    expect(service.execute).toHaveBeenCalledWith({
      name: 'New Name',
      workspaceId: WORKSPACE_ID,
      sub: 'user-1',
    });
  });
});
