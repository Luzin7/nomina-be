import { GoalNotFoundError } from '@modules/goal/errors';
import { invalidateGoalReads } from '@modules/goal/services/goal-cache';
import {
  makeGoalContributionRecord,
  makeGoalContributionRepository,
  makeGoalRecord,
  makeGoalRepository,
} from '@modules/goal/test-helpers/goal-factories';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { ListGoalContributionsService } from './list-goal-contributions.service';

const REQUEST = { workspaceId: 'ws-1', goalId: 'goal-1' };

describe('ListGoalContributionsService', () => {
  let service: ListGoalContributionsService;
  let goalRepository: ReturnType<typeof makeGoalRepository>;
  let contributionRepository: ReturnType<typeof makeGoalContributionRepository>;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    goalRepository = makeGoalRepository();
    contributionRepository = makeGoalContributionRepository();
    cache = new InMemoryCacheProvider();
    goalRepository.findById.mockResolvedValue(makeGoalRecord());
    contributionRepository.listContributionsByGoal.mockResolvedValue([]);

    service = new ListGoalContributionsService(
      goalRepository,
      contributionRepository,
      cache,
    );
  });

  it('returns an empty list when the goal has no contributions', async () => {
    const result = await service.execute(REQUEST);

    if (result.isLeft()) throw result.value;
    expect(result.value.contributions).toEqual([]);
  });

  it('returns the contributions of the goal of the workspace', async () => {
    const record = makeGoalContributionRecord();
    contributionRepository.listContributionsByGoal.mockResolvedValue([record]);

    const result = await service.execute(REQUEST);

    if (result.isLeft()) throw result.value;
    expect(result.value.contributions).toEqual([record]);
    expect(contributionRepository.listContributionsByGoal).toHaveBeenCalledWith(
      'goal-1',
      'ws-1',
    );
  });

  it('returns not found when the goal is not in the workspace', async () => {
    goalRepository.findById.mockResolvedValue(null);

    const result = await service.execute(REQUEST);

    expect(result.value).toBeInstanceOf(GoalNotFoundError);
  });

  it('serves the second read from the cache', async () => {
    await service.execute(REQUEST);
    await service.execute(REQUEST);

    expect(
      contributionRepository.listContributionsByGoal,
    ).toHaveBeenCalledTimes(1);
  });

  it('recomputes after a goal write bumps the generation', async () => {
    await service.execute(REQUEST);
    await invalidateGoalReads(cache, 'ws-1', 'test');
    await service.execute(REQUEST);

    expect(
      contributionRepository.listContributionsByGoal,
    ).toHaveBeenCalledTimes(2);
  });
});
