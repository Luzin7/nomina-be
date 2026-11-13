import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { Goal } from '@modules/goal/entities/Goal';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import {
  makeGoalRecord,
  makeGoalRepository,
} from '@modules/goal/test-helpers/goal-factories';
import { ListGoalsService } from './list-goals.service';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';

describe('ListGoalsService', () => {
  let service: ListGoalsService;
  let goalRepository: ReturnType<typeof makeGoalRepository>;

  beforeEach(() => {
    goalRepository = makeGoalRepository();
    goalRepository.listByWorkspace.mockResolvedValue([]);
    goalRepository.getSummaryAggregates.mockResolvedValue({
      totalTargetCents: 0,
      totalCurrentCents: 0,
      activeCount: 0,
      completedCount: 0,
      unsetTargetCount: 0,
    });
    goalRepository.sumMonthlyAporteCents.mockResolvedValue(0);

    service = new ListGoalsService(
      goalRepository,
      {
        execute: jest.fn().mockResolvedValue(TIMEZONE),
      } as unknown as GetWorkspaceTimezoneService,
      {
        now: () => NOW,
        format: () => '2026-11-09',
      } as unknown as DateProvider,
      new InMemoryCacheProvider(),
    );
  });

  it('seeds the emergency goal before listing', async () => {
    await service.execute({ workspaceId: 'ws-1' });

    expect(goalRepository.seedEmergencyGoal).toHaveBeenCalledWith('ws-1');
    expect(
      goalRepository.seedEmergencyGoal.mock.invocationCallOrder[0],
    ).toBeLessThan(goalRepository.listByWorkspace.mock.invocationCallOrder[0]);
  });

  it('returns the rows in the order the repository resolved them', async () => {
    goalRepository.listByWorkspace.mockResolvedValue([
      makeGoalRecord({ id: 'emergency', isEmergency: true, isSystem: true }),
      makeGoalRecord({
        id: 'goal-2',
        createdAt: new Date('2026-11-02T12:00:00.000Z'),
      }),
      makeGoalRecord({
        id: 'goal-3',
        createdAt: new Date('2026-11-03T12:00:00.000Z'),
      }),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    if (result.isLeft()) throw result.value;
    expect(result.value.goals.map((goal: Goal) => goal.record.id)).toEqual([
      'emergency',
      'goal-2',
      'goal-3',
    ]);
  });

  it('returns the same monthly aporte the hero reads from the repository', async () => {
    goalRepository.sumMonthlyAporteCents.mockResolvedValue(300);
    goalRepository.getSummaryAggregates.mockResolvedValue({
      totalTargetCents: 1_000,
      totalCurrentCents: 200,
      activeCount: 1,
      completedCount: 0,
      unsetTargetCount: 2,
    });

    const result = await service.execute({ workspaceId: 'ws-1' });

    if (result.isLeft()) throw result.value;
    expect(result.value.summary).toEqual({
      monthlyAporteCents: 300,
      totalTargetCents: 1_000,
      totalCurrentCents: 200,
      activeCount: 1,
      completedCount: 0,
      unsetTargetCount: 2,
    });
  });
});
