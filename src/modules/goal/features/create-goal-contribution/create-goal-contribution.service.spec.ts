import {
  GoalContributionIdConflictError,
  GoalLinkedAccountInvalidError,
  GoalNotFoundError,
} from '@modules/goal/errors';
import {
  goalGenerationKey,
  readGoalGeneration,
} from '@modules/goal/services/goal-cache';
import { ValidateGoalLinksService } from '@modules/goal/services/validate-goal-links.service';
import {
  makeAccount,
  makeAccountRepository,
  makeCategoryRepository,
  makeGoalContributionRecord,
  makeGoalContributionRepository,
  makeGoalRecord,
} from '@modules/goal/test-helpers/goal-factories';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { CreateGoalContributionService } from './create-goal-contribution.service';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';
const CONTRIBUTION_ID = '7f1d1f4e-52a0-4d0c-9a53-1c3f0d6f8a11';
const REQUEST = {
  workspaceId: 'ws-1',
  goalId: 'goal-1',
  id: CONTRIBUTION_ID,
  amountCents: 5_000,
};

describe('CreateGoalContributionService', () => {
  let service: CreateGoalContributionService;
  let contributionRepository: ReturnType<typeof makeGoalContributionRepository>;
  let accountRepository: ReturnType<typeof makeAccountRepository>;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    contributionRepository = makeGoalContributionRepository();
    accountRepository = makeAccountRepository();
    cache = new InMemoryCacheProvider();
    contributionRepository.recordContribution.mockResolvedValue({
      status: 'recorded',
      contribution: makeGoalContributionRecord({ id: CONTRIBUTION_ID }),
      goal: makeGoalRecord({ currentCents: 5_000 }),
    });

    service = new CreateGoalContributionService(
      contributionRepository,
      new ValidateGoalLinksService(accountRepository, makeCategoryRepository()),
      {
        execute: jest.fn().mockResolvedValue(TIMEZONE),
      } as unknown as GetWorkspaceTimezoneService,
      { now: () => NOW } as unknown as DateProvider,
      cache,
    );
  });

  it('records the contribution of the goal of the workspace', async () => {
    await service.execute(REQUEST);

    expect(contributionRepository.recordContribution).toHaveBeenCalledWith({
      id: CONTRIBUTION_ID,
      workspaceId: 'ws-1',
      goalId: 'goal-1',
      amountCents: 5_000,
      sourceAccountId: null,
    });
  });

  it('returns the contribution, the goal, the clock and the timezone', async () => {
    const result = await service.execute(REQUEST);

    if (result.isLeft()) throw result.value;
    expect(result.value.contribution.id).toBe(CONTRIBUTION_ID);
    expect(result.value.goal.record.currentCents).toBe(5_000);
    expect(result.value.now).toEqual(NOW);
    expect(result.value.timezone).toBe(TIMEZONE);
  });

  it('bumps the goal generation when the row was inserted', async () => {
    const before = await readGoalGeneration(cache, 'ws-1');
    await service.execute(REQUEST);

    expect(cache.counters.get(goalGenerationKey('ws-1'))).toBe(
      (before as number) + 1,
    );
  });

  it('returns the existing row on a replay without bumping the generation', async () => {
    contributionRepository.recordContribution.mockResolvedValue({
      status: 'replayed',
      contribution: makeGoalContributionRecord({ id: CONTRIBUTION_ID }),
      goal: makeGoalRecord({ currentCents: 5_000 }),
    });

    const result = await service.execute(REQUEST);

    expect(result.isRight()).toBe(true);
    expect(cache.counters.has(goalGenerationKey('ws-1'))).toBe(false);
  });

  it('rejects an id that belongs to another goal or workspace', async () => {
    contributionRepository.recordContribution.mockResolvedValue({
      status: 'id-conflict',
    });

    const result = await service.execute(REQUEST);

    expect(result.value).toBeInstanceOf(GoalContributionIdConflictError);
    expect(cache.counters.has(goalGenerationKey('ws-1'))).toBe(false);
  });

  it('returns not found when the goal is not in the workspace', async () => {
    contributionRepository.recordContribution.mockResolvedValue({
      status: 'goal-not-found',
    });

    const result = await service.execute(REQUEST);

    expect(result.value).toBeInstanceOf(GoalNotFoundError);
  });

  it('rejects a source account of another workspace before writing', async () => {
    accountRepository.findById.mockResolvedValue(
      makeAccount({ workspaceId: 'ws-2' }),
    );

    const result = await service.execute({
      ...REQUEST,
      sourceAccountId: 'account-1',
    });

    expect(result.value).toBeInstanceOf(GoalLinkedAccountInvalidError);
    expect(contributionRepository.recordContribution).not.toHaveBeenCalled();
  });

  it('forwards a valid source account', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount());

    await service.execute({ ...REQUEST, sourceAccountId: 'account-1' });

    expect(contributionRepository.recordContribution).toHaveBeenCalledWith(
      expect.objectContaining({ sourceAccountId: 'account-1' }),
    );
  });

  it('returns the named account error when the repository finds the source account gone', async () => {
    contributionRepository.recordContribution.mockResolvedValue({
      status: 'source-account-invalid',
    });

    const result = await service.execute(REQUEST);

    expect(result.value).toBeInstanceOf(GoalLinkedAccountInvalidError);
    expect(cache.counters.has(goalGenerationKey('ws-1'))).toBe(false);
  });
});
