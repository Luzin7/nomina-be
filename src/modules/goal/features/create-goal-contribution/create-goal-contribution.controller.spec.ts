import { UserRole } from '@constants/enums';
import { Goal } from '@modules/goal/entities/Goal';
import {
  makeGoalContributionRecord,
  makeGoalRecord,
} from '@modules/goal/test-helpers/goal-factories';
import { ConflictException } from '@nestjs/common';
import { ROLES_KEY } from '@providers/auth/decorators/Roles.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { left, right } from '@shared/core/errors/Either';
import { CreateGoalContributionController } from './create-goal-contribution.controller';
import type { CreateGoalContributionService } from './create-goal-contribution.service';
import { GoalContributionIdConflictError } from '@modules/goal/errors';

const CONTRIBUTION_ID = '7f1d1f4e-52a0-4d0c-9a53-1c3f0d6f8a11';
const USER = { workspaceId: 'ws-1' } as TokenPayloadSchema;
const BODY = { id: CONTRIBUTION_ID, amountCents: 5_000 };

describe('CreateGoalContributionController', () => {
  let service: jest.Mocked<CreateGoalContributionService>;
  let controller: CreateGoalContributionController;

  beforeEach(() => {
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<CreateGoalContributionService>;
    controller = new CreateGoalContributionController(service);
  });

  it('allows owner, admin and user, never viewer', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, CreateGoalContributionController),
    ).toEqual([UserRole.OWNER, UserRole.ADMIN, UserRole.USER]);
  });

  it('answers 201', () => {
    expect(
      Reflect.getMetadata(
        '__httpCode__',
        CreateGoalContributionController.prototype.handle,
      ),
    ).toBe(201);
  });

  it('answers 409 for an id owned by another goal', async () => {
    service.execute.mockResolvedValue(
      left(new GoalContributionIdConflictError()),
    );

    await expect(
      controller.handle(USER, { id: 'goal-1' }, BODY),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('passes the workspace, the goal id and the body to the service', async () => {
    service.execute.mockResolvedValue(
      right({
        contribution: makeGoalContributionRecord(),
        goal: Goal.fromRecord(makeGoalRecord()),
        now: new Date(),
        timezone: 'UTC',
      }),
    );

    await controller.handle(USER, { id: 'goal-1' }, BODY);

    expect(service.execute).toHaveBeenCalledWith({
      ...BODY,
      goalId: 'goal-1',
      workspaceId: 'ws-1',
    });
  });

  it('wraps the contribution and the goal in the data envelope', async () => {
    service.execute.mockResolvedValue(
      right({
        contribution: makeGoalContributionRecord({ id: CONTRIBUTION_ID }),
        goal: Goal.fromRecord(makeGoalRecord({ currentCents: 5_000 })),
        now: new Date('2026-11-10T12:00:00.000Z'),
        timezone: 'UTC',
      }),
    );

    const result = await controller.handle(USER, { id: 'goal-1' }, BODY);

    expect(result).toMatchObject({
      data: {
        contribution: {
          id: CONTRIBUTION_ID,
          goalId: 'goal-1',
          amountCents: 5_000,
          sourceAccountId: null,
          contributedAt: '2026-11-10T12:00:00.000Z',
        },
        goal: { id: 'goal-1', currentCents: 5_000 },
      },
    });
  });
});
