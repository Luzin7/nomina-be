import { UserRole } from '@constants/enums';
import { GoalContributionNotFoundError } from '@modules/goal/errors';
import { ROLES_KEY } from '@providers/auth/decorators/Roles.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { left, right } from '@shared/core/errors/Either';
import { DeleteGoalContributionController } from './delete-goal-contribution.controller';
import { DeleteGoalContributionParamsPipe } from './delete-goal-contribution.dto';
import type { DeleteGoalContributionService } from './delete-goal-contribution.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const USER = { workspaceId: 'ws-1' } as TokenPayloadSchema;
const PARAMS = { id: 'goal-1', contributionId: 'contribution-1' };

describe('DeleteGoalContributionController', () => {
  let service: jest.Mocked<DeleteGoalContributionService>;
  let controller: DeleteGoalContributionController;

  beforeEach(() => {
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<DeleteGoalContributionService>;
    controller = new DeleteGoalContributionController(service);
  });

  it('allows owner, admin and user, never viewer', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, DeleteGoalContributionController),
    ).toEqual([UserRole.OWNER, UserRole.ADMIN, UserRole.USER]);
  });

  it('answers 204', () => {
    expect(
      Reflect.getMetadata(
        '__httpCode__',
        DeleteGoalContributionController.prototype.handle,
      ),
    ).toBe(204);
  });

  it('passes the workspace and both ids to the service', async () => {
    service.execute.mockResolvedValue(right(undefined));

    await controller.handle(USER, PARAMS);

    expect(service.execute).toHaveBeenCalledWith({
      goalId: 'goal-1',
      contributionId: 'contribution-1',
      workspaceId: 'ws-1',
    });
  });

  it('answers 404 for a missing contribution', async () => {
    service.execute.mockResolvedValue(
      left(new GoalContributionNotFoundError()),
    );

    await expect(controller.handle(USER, PARAMS)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('DeleteGoalContributionParamsPipe', () => {
  it('rejects an empty contribution id', () => {
    expect(() =>
      DeleteGoalContributionParamsPipe.transform({
        id: 'goal-1',
        contributionId: '',
      }),
    ).toThrow(BadRequestException);
  });
});
