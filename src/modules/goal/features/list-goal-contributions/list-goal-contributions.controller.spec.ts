import { UserRole } from '@constants/enums';
import { makeGoalContributionRecord } from '@modules/goal/test-helpers/goal-factories';
import { ROLES_KEY } from '@providers/auth/decorators/Roles.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { right } from '@shared/core/errors/Either';
import { ListGoalContributionsController } from './list-goal-contributions.controller';
import type { ListGoalContributionsService } from './list-goal-contributions.service';

const USER = { workspaceId: 'ws-1' } as TokenPayloadSchema;

describe('ListGoalContributionsController', () => {
  let service: jest.Mocked<ListGoalContributionsService>;
  let controller: ListGoalContributionsController;

  beforeEach(() => {
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ListGoalContributionsService>;
    controller = new ListGoalContributionsController(service);
  });

  it('allows every role, viewer included', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, ListGoalContributionsController),
    ).toEqual([UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER]);
  });

  it('answers 200', () => {
    expect(
      Reflect.getMetadata(
        '__httpCode__',
        ListGoalContributionsController.prototype.handle,
      ),
    ).toBe(200);
  });

  it('wraps an empty list in the data envelope', async () => {
    service.execute.mockResolvedValue(right({ contributions: [] }));

    const result = await controller.handle(USER, { id: 'goal-1' });

    expect(result).toEqual({ data: [] });
  });

  it('presents each contribution with ISO dates', async () => {
    service.execute.mockResolvedValue(
      right({
        contributions: [
          makeGoalContributionRecord({ sourceAccountId: 'account-1' }),
        ],
      }),
    );

    const result = await controller.handle(USER, { id: 'goal-1' });

    expect(result).toEqual({
      data: [
        {
          id: '7f1d1f4e-52a0-4d0c-9a53-1c3f0d6f8a11',
          goalId: 'goal-1',
          amountCents: 5_000,
          sourceAccountId: 'account-1',
          contributedAt: '2026-11-10T12:00:00.000Z',
          createdAt: '2026-11-10T12:00:00.000Z',
        },
      ],
    });
  });
});
