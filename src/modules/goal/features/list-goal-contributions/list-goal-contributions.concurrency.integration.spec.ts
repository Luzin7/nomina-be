import * as schema from '@infra/databases/drizzle/schema';
import { GoalNotFoundError } from '@modules/goal/errors';
import {
  ContributionHarness,
  seedGoal,
  startContributionHarness,
} from '@modules/goal/test-helpers/goal-contribution-integration';
import { randomUUID } from 'node:crypto';
import { ListGoalContributionsService } from './list-goal-contributions.service';

jest.setTimeout(180_000);

describe('goal contribution GET against a real postgres', () => {
  let harness: ContributionHarness;
  let service: ListGoalContributionsService;

  beforeAll(async () => {
    harness = await startContributionHarness();
    service = harness.app.get(ListGoalContributionsService);
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it('returns an empty list when the goal has no contributions', async () => {
    const { workspaceId, goalId } = await seedGoal(harness);

    const result = await service.execute({ workspaceId, goalId });

    if (result.isLeft()) throw result.value;
    expect(result.value.contributions).toEqual([]);
  });

  it('returns the newest contribution first', async () => {
    const { workspaceId, goalId } = await seedGoal(harness);
    const [oldest, middle, newest] = [randomUUID(), randomUUID(), randomUUID()];
    await harness.db.insert(schema.goalContributions).values([
      {
        id: middle,
        workspaceId,
        goalId,
        amountCents: 2_000,
        contributedAt: new Date('2026-11-02T12:00:00.000Z'),
      },
      {
        id: oldest,
        workspaceId,
        goalId,
        amountCents: 1_000,
        contributedAt: new Date('2026-11-01T12:00:00.000Z'),
      },
      {
        id: newest,
        workspaceId,
        goalId,
        amountCents: 3_000,
        contributedAt: new Date('2026-11-03T12:00:00.000Z'),
      },
    ]);

    const result = await service.execute({ workspaceId, goalId });

    if (result.isLeft()) throw result.value;
    expect(result.value.contributions.map(({ id }) => id)).toEqual([
      newest,
      middle,
      oldest,
    ]);
  });

  it('answers 404 for the goal of another workspace', async () => {
    const owner = await seedGoal(harness);
    const stranger = await seedGoal(harness);

    const result = await service.execute({
      workspaceId: stranger.workspaceId,
      goalId: owner.goalId,
    });

    expect(result.value).toBeInstanceOf(GoalNotFoundError);
  });
});
