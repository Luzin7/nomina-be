import {
  GoalContributionNotFoundError,
  GoalContributionUndoConflictError,
  GoalNotFoundError,
} from '@modules/goal/errors';
import {
  goalGenerationKey,
  readGoalGeneration,
} from '@modules/goal/services/goal-cache';
import { makeGoalContributionRepository } from '@modules/goal/test-helpers/goal-factories';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { DeleteGoalContributionService } from './delete-goal-contribution.service';

const REQUEST = {
  workspaceId: 'ws-1',
  goalId: 'goal-1',
  contributionId: 'contribution-1',
};

describe('DeleteGoalContributionService', () => {
  let service: DeleteGoalContributionService;
  let contributionRepository: ReturnType<typeof makeGoalContributionRepository>;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    contributionRepository = makeGoalContributionRepository();
    cache = new InMemoryCacheProvider();
    contributionRepository.undoContribution.mockResolvedValue({
      status: 'undone',
    });

    service = new DeleteGoalContributionService(contributionRepository, cache);
  });

  it('undoes the contribution of the goal of the workspace', async () => {
    const result = await service.execute(REQUEST);

    expect(result.isRight()).toBe(true);
    expect(contributionRepository.undoContribution).toHaveBeenCalledWith({
      id: 'contribution-1',
      goalId: 'goal-1',
      workspaceId: 'ws-1',
    });
  });

  it('bumps the goal generation after the undo', async () => {
    const before = await readGoalGeneration(cache, 'ws-1');
    await service.execute(REQUEST);

    expect(cache.counters.get(goalGenerationKey('ws-1'))).toBe(
      (before as number) + 1,
    );
  });

  it('returns a named not found for a missing contribution', async () => {
    contributionRepository.undoContribution.mockResolvedValue({
      status: 'contribution-not-found',
    });

    const result = await service.execute(REQUEST);

    expect(result.value).toBeInstanceOf(GoalContributionNotFoundError);
    expect(cache.counters.has(goalGenerationKey('ws-1'))).toBe(false);
  });

  it('returns not found when the goal is not in the workspace', async () => {
    contributionRepository.undoContribution.mockResolvedValue({
      status: 'goal-not-found',
    });

    const result = await service.execute(REQUEST);

    expect(result.value).toBeInstanceOf(GoalNotFoundError);
  });

  it('returns a conflict when the undo would break the goal balance', async () => {
    contributionRepository.undoContribution.mockResolvedValue({
      status: 'undo-conflict',
    });

    const result = await service.execute(REQUEST);

    expect(result.value).toBeInstanceOf(GoalContributionUndoConflictError);
    expect(cache.counters.has(goalGenerationKey('ws-1'))).toBe(false);
  });
});
