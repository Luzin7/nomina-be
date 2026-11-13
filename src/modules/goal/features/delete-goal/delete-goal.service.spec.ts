import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import {
  EmergencyGoalNotDeletableError,
  GoalNotFoundError,
} from '@modules/goal/errors';
import {
  makeGoalRecord,
  makeGoalRepository,
} from '@modules/goal/test-helpers/goal-factories';
import { DeleteGoalService } from './delete-goal.service';

describe('DeleteGoalService', () => {
  let service: DeleteGoalService;
  let goalRepository: ReturnType<typeof makeGoalRepository>;

  beforeEach(() => {
    goalRepository = makeGoalRepository();
    service = new DeleteGoalService(
      goalRepository,
      new InMemoryCacheProvider(),
    );
  });

  it('deletes a normal goal of the workspace', async () => {
    goalRepository.findById.mockResolvedValue(makeGoalRecord());
    goalRepository.delete.mockResolvedValue(true);

    const result = await service.execute({ id: 'goal-1', workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    expect(goalRepository.delete).toHaveBeenCalledWith('goal-1', 'ws-1');
  });

  it('answers 409 for the emergency goal and keeps the row', async () => {
    goalRepository.findById.mockResolvedValue(
      makeGoalRecord({ isEmergency: true, isSystem: true }),
    );

    const result = await service.execute({
      id: 'emergency',
      workspaceId: 'ws-1',
    });

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(EmergencyGoalNotDeletableError);
    expect(goalRepository.delete).not.toHaveBeenCalled();
  });

  it('answers 404 for a goal of another workspace and writes nothing', async () => {
    goalRepository.findById.mockResolvedValue(null);

    const result = await service.execute({ id: 'goal-1', workspaceId: 'ws-2' });

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(GoalNotFoundError);
    expect(goalRepository.delete).not.toHaveBeenCalled();
  });

  it('answers 404 when the goal disappears between the read and the delete', async () => {
    goalRepository.findById.mockResolvedValue(makeGoalRecord());
    goalRepository.delete.mockResolvedValue(false);

    const result = await service.execute({ id: 'goal-1', workspaceId: 'ws-1' });

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(GoalNotFoundError);
  });
});
