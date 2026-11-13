import * as schema from '@infra/databases/drizzle/schema';
import {
  GoalContributionIdConflictError,
  GoalLinkedAccountInvalidError,
  GoalNotFoundError,
} from '@modules/goal/errors';
import {
  ContributionHarness,
  OPENING_BALANCE,
  seedGoal,
  startContributionHarness,
} from '@modules/goal/test-helpers/goal-contribution-integration';
import { count, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CreateGoalContributionService } from './create-goal-contribution.service';

const AMOUNT_CENTS = 5_000;
const CONCURRENT_POSTS = 8;

jest.setTimeout(180_000);

describe('goal contribution POST against a real postgres', () => {
  let harness: ContributionHarness;
  let service: CreateGoalContributionService;

  beforeAll(async () => {
    harness = await startContributionHarness();
    service = harness.app.get(CreateGoalContributionService);
  });

  afterAll(async () => {
    await harness?.stop();
  });

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

  it('counts one contribution once when the same id is posted twice', async () => {
    const { workspaceId, goalId } = await seedGoal(harness);
    const id = randomUUID();

    const first = await service.execute({
      workspaceId,
      goalId,
      id,
      amountCents: AMOUNT_CENTS,
    });
    const second = await service.execute({
      workspaceId,
      goalId,
      id,
      amountCents: AMOUNT_CENTS,
    });

    expect(first.isRight()).toBe(true);
    expect(second.isRight()).toBe(true);
    expect(await rowsOf(id)).toHaveLength(1);
    expect(await currentCentsOf(goalId)).toBe(AMOUNT_CENTS);
  });

  it('returns the stored row on a replay with a different amount', async () => {
    const { workspaceId, goalId } = await seedGoal(harness);
    const id = randomUUID();
    await service.execute({
      workspaceId,
      goalId,
      id,
      amountCents: AMOUNT_CENTS,
    });

    const replay = await service.execute({
      workspaceId,
      goalId,
      id,
      amountCents: AMOUNT_CENTS * 2,
    });

    if (replay.isLeft()) throw replay.value;
    expect(replay.value.contribution.amountCents).toBe(AMOUNT_CENTS);
    expect(await currentCentsOf(goalId)).toBe(AMOUNT_CENTS);
  });

  it('keeps one row when concurrent posts share an id', async () => {
    const { workspaceId, goalId } = await seedGoal(harness);
    const id = randomUUID();

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_POSTS }, () =>
        service.execute({ workspaceId, goalId, id, amountCents: AMOUNT_CENTS }),
      ),
    );

    expect(results.every((result) => result.isRight())).toBe(true);
    expect(await rowsOf(id)).toHaveLength(1);
    expect(await currentCentsOf(goalId)).toBe(AMOUNT_CENTS);
  });

  it('sums concurrent posts with distinct ids', async () => {
    const { workspaceId, goalId } = await seedGoal(harness);

    await Promise.all(
      Array.from({ length: CONCURRENT_POSTS }, () =>
        service.execute({
          workspaceId,
          goalId,
          id: randomUUID(),
          amountCents: AMOUNT_CENTS,
        }),
      ),
    );

    expect(await currentCentsOf(goalId)).toBe(AMOUNT_CENTS * CONCURRENT_POSTS);
  });

  it('answers 409 for an id replayed on another goal and keeps both goals', async () => {
    const first = await seedGoal(harness);
    const otherGoalId = randomUUID();
    await harness.db.insert(schema.goals).values({
      id: otherGoalId,
      workspaceId: first.workspaceId,
      name: 'Carro',
      targetCents: 100_000,
    });
    const id = randomUUID();
    await service.execute({
      workspaceId: first.workspaceId,
      goalId: first.goalId,
      id,
      amountCents: AMOUNT_CENTS,
    });

    const replay = await service.execute({
      workspaceId: first.workspaceId,
      goalId: otherGoalId,
      id,
      amountCents: AMOUNT_CENTS,
    });

    expect(replay.value).toBeInstanceOf(GoalContributionIdConflictError);
    expect(await currentCentsOf(otherGoalId)).toBe(0);
    expect(await currentCentsOf(first.goalId)).toBe(AMOUNT_CENTS);
    expect((await rowsOf(id))[0].goalId).toBe(first.goalId);
  });

  it('answers 409 for an id replayed on another workspace', async () => {
    const first = await seedGoal(harness);
    const second = await seedGoal(harness);
    const id = randomUUID();
    await service.execute({
      workspaceId: first.workspaceId,
      goalId: first.goalId,
      id,
      amountCents: AMOUNT_CENTS,
    });

    const replay = await service.execute({
      workspaceId: second.workspaceId,
      goalId: second.goalId,
      id,
      amountCents: AMOUNT_CENTS,
    });

    expect(replay.value).toBeInstanceOf(GoalContributionIdConflictError);
    expect(await currentCentsOf(second.goalId)).toBe(0);
    expect((await rowsOf(id))[0].workspaceId).toBe(first.workspaceId);
  });

  it('answers 404 for the goal of another workspace and writes nothing', async () => {
    const owner = await seedGoal(harness);
    const stranger = await seedGoal(harness);
    const id = randomUUID();

    const result = await service.execute({
      workspaceId: stranger.workspaceId,
      goalId: owner.goalId,
      id,
      amountCents: AMOUNT_CENTS,
    });

    expect(result.value).toBeInstanceOf(GoalNotFoundError);
    expect(await rowsOf(id)).toHaveLength(0);
    expect(await currentCentsOf(owner.goalId)).toBe(0);
  });

  it('answers 404 for a goal that does not exist', async () => {
    const { workspaceId } = await seedGoal(harness);

    const result = await service.execute({
      workspaceId,
      goalId: randomUUID(),
      id: randomUUID(),
      amountCents: AMOUNT_CENTS,
    });

    expect(result.value).toBeInstanceOf(GoalNotFoundError);
  });

  it('rejects a source account of another workspace and writes nothing', async () => {
    const owner = await seedGoal(harness);
    const stranger = await seedGoal(harness);
    const id = randomUUID();

    const result = await service.execute({
      workspaceId: owner.workspaceId,
      goalId: owner.goalId,
      id,
      amountCents: AMOUNT_CENTS,
      sourceAccountId: stranger.accountId,
    });

    expect(result.value).toBeInstanceOf(GoalLinkedAccountInvalidError);
    expect(await rowsOf(id)).toHaveLength(0);
  });

  it('stores the source account of the workspace', async () => {
    const { workspaceId, goalId, accountId } = await seedGoal(harness);
    const id = randomUUID();

    await service.execute({
      workspaceId,
      goalId,
      id,
      amountCents: AMOUNT_CENTS,
      sourceAccountId: accountId,
    });

    expect((await rowsOf(id))[0].sourceAccountId).toBe(accountId);
  });

  it('moves no transaction and no account balance', async () => {
    const { workspaceId, goalId, accountId } = await seedGoal(harness);
    const [before] = await harness.db
      .select({ total: count() })
      .from(schema.transactions);

    await service.execute({
      workspaceId,
      goalId,
      id: randomUUID(),
      amountCents: AMOUNT_CENTS,
      sourceAccountId: accountId,
    });

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
