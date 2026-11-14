import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { makeGoalRepository } from '@modules/goal/test-helpers/goal-factories';
import { GetGoalsSummaryService } from './get-goals-summary.service';

describe('GetGoalsSummaryService', () => {
  let service: GetGoalsSummaryService;
  let goalRepository: ReturnType<typeof makeGoalRepository>;

  beforeEach(() => {
    goalRepository = makeGoalRepository();
    goalRepository.getSummaryAggregates.mockResolvedValue({
      totalTargetCents: 1_000,
      totalCurrentCents: 200,
      activeCount: 1,
      completedCount: 0,
      unsetTargetCount: 2,
    });
    goalRepository.sumMonthlyAporteCents.mockResolvedValue(300);

    service = new GetGoalsSummaryService(
      goalRepository,
      new InMemoryCacheProvider(),
    );
  });

  it('seeds the emergency goal before aggregating', async () => {
    await service.execute({ workspaceId: 'ws-1' });

    expect(goalRepository.seedEmergencyGoal).toHaveBeenCalledWith('ws-1');
    expect(
      goalRepository.seedEmergencyGoal.mock.invocationCallOrder[0],
    ).toBeLessThan(
      goalRepository.getSummaryAggregates.mock.invocationCallOrder[0],
    );
  });

  it('returns the repository sum as the monthly aporte', async () => {
    const result = await service.execute({ workspaceId: 'ws-1' });

    if (result.isLeft()) throw result.value;
    expect(result.value).toEqual({
      monthlyAporteCents: 300,
      totalTargetCents: 1_000,
      totalCurrentCents: 200,
      activeCount: 1,
      completedCount: 0,
      unsetTargetCount: 2,
    });
  });
});
