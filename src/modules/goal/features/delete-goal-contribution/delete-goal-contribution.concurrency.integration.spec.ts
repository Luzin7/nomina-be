import * as schema from '@infra/databases/drizzle/schema';
import {
  GoalContributionNotFoundError,
  GoalContributionUndoConflictError,
  GoalNotFoundError,
} from '@modules/goal/errors';
import { CreateGoalContributionService } from '@modules/goal/features/create-goal-contribution/create-goal-contribution.service';
import { UpdateGoalService } from '@modules/goal/features/update-goal/update-goal.service';
import {
  ContributionHarness,
  OPENING_BALANCE,
  seedGoal,
  startContributionHarness,
} from '@modules/goal/test-helpers/goal-contribution-integration';
import { count, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DeleteGoalContributionService } from './delete-goal-contribution.service';

const AMOUNT_CENTS = 5_000;
const MANUAL_CUT_CENTS = 1_000;

jest.setTimeout(180_000);

describe('goal contribution DELETE against a real postgres', () => {
  let harness: ContributionHarness;
  let create: CreateGoalContributionService;
  let remove: DeleteGoalContributionService;

  beforeAll(async () => {
    harness = await startContributionHarness();
    create = harness.app.get(CreateGoalContributionService);
    remove = harness.app.get(DeleteGoalContributionService);
  });

  afterAll(async () => {
    await harness?.stop();
  });

  async function contribute(workspaceId: string, goalId: string) {
    const id = randomUUID();
    const result = await create.execute({
      workspaceId,
      goalId,
      id,
      amountCents: AMOUNT_CENTS,
    });
    if (result.isLeft()) throw result.value;

    return id;
  }

  async function rowsOf(contributionId: string) {
    return harness.db
      .select()
      .from(schema.goalContributions)
      .where(eq(schema.goalContributions.id, contributionId));
  }

  async function currentCentsOf(goalId: string): Promise<number> {
    const [goal] = await harness.db
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.id, goalId));

    return goal.currentCents;
  }

  it('removes the row and restores current_cents', async () => {
    const { workspaceId, goalId } = await seedGoal(harness, 2_000);
    const id = await contribute(workspaceId, goalId);

    const result = await remove.execute({
      workspaceId,
      goalId,
      contributionId: id,
    });

    expect(result.isRight()).toBe(true);
    expect(await rowsOf(id)).toHaveLength(0);
    expect(await currentCentsOf(goalId)).toBe(2_000);
  });

  it('answers 404 on the second delete and keeps current_cents', async () => {
    const { workspaceId, goalId } = await seedGoal(harness, 2_000);
    const id = await contribute(workspaceId, goalId);
    const params = { workspaceId, goalId, contributionId: id };
    await remove.execute(params);

    const second = await remove.execute(params);

    expect(second.value).toBeInstanceOf(GoalContributionNotFoundError);
    expect(await currentCentsOf(goalId)).toBe(2_000);
  });

  it('answers 409 after a manual cut, keeps the row and never clamps', async () => {
    const { workspaceId, goalId } = await seedGoal(harness);
    const id = await contribute(workspaceId, goalId);
    await harness.app.get(UpdateGoalService).execute({
      id: goalId,
      workspaceId,
      currentCents: MANUAL_CUT_CENTS,
    });

    const result = await remove.execute({
      workspaceId,
      goalId,
      contributionId: id,
    });

    expect(result.value).toBeInstanceOf(GoalContributionUndoConflictError);
    expect(await rowsOf(id)).toHaveLength(1);
    expect(await currentCentsOf(goalId)).toBe(MANUAL_CUT_CENTS);
  });

  it('answers 404 for the goal of another workspace and keeps the row', async () => {
    const owner = await seedGoal(harness);
    const stranger = await seedGoal(harness);
    const id = await contribute(owner.workspaceId, owner.goalId);

    const result = await remove.execute({
      workspaceId: stranger.workspaceId,
      goalId: owner.goalId,
      contributionId: id,
    });

    expect(result.value).toBeInstanceOf(GoalNotFoundError);
    expect(await rowsOf(id)).toHaveLength(1);
    expect(await currentCentsOf(owner.goalId)).toBe(AMOUNT_CENTS);
  });

  it('answers 404 for a contribution that belongs to another goal', async () => {
    const owner = await seedGoal(harness);
    const otherGoalId = randomUUID();
    await harness.db.insert(schema.goals).values({
      id: otherGoalId,
      workspaceId: owner.workspaceId,
      name: 'Carro',
      targetCents: 100_000,
    });
    const id = await contribute(owner.workspaceId, owner.goalId);

    const result = await remove.execute({
      workspaceId: owner.workspaceId,
      goalId: otherGoalId,
      contributionId: id,
    });

    expect(result.value).toBeInstanceOf(GoalContributionNotFoundError);
    expect(await rowsOf(id)).toHaveLength(1);
  });

  it('serializes two concurrent deletes into one subtraction', async () => {
    const { workspaceId, goalId } = await seedGoal(harness);
    const id = await contribute(workspaceId, goalId);
    const params = { workspaceId, goalId, contributionId: id };

    const results = await Promise.all([
      remove.execute(params),
      remove.execute(params),
    ]);

    expect(results.filter((result) => result.isRight())).toHaveLength(1);
    expect(await currentCentsOf(goalId)).toBe(0);
  });

  it('moves no transaction and no account balance', async () => {
    const { workspaceId, goalId, accountId } = await seedGoal(harness);
    const id = await contribute(workspaceId, goalId);
    const [before] = await harness.db
      .select({ total: count() })
      .from(schema.transactions);

    await remove.execute({ workspaceId, goalId, contributionId: id });

    const [after] = await harness.db
      .select({ total: count() })
      .from(schema.transactions);
    const [account] = await harness.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId));
    expect(after.total).toBe(before.total);
    expect(account.balance).toBe(Number(OPENING_BALANCE));
  });
});
