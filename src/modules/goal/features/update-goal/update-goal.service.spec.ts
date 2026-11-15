import { GoalProgressSource } from '@constants/enums';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import {
  GoalAccountSourceRequiresLinkError,
  GoalCurrentTracksAccountError,
  GoalLinkedAccountInvalidError,
  GoalNotFoundError,
  InvalidGoalNameError,
} from '@modules/goal/errors';
import {
  GoalRecord,
  UpdateGoalInput,
} from '@modules/goal/repositories/contracts/GoalRepository';
import { ValidateGoalLinksService } from '@modules/goal/services/validate-goal-links.service';
import {
  makeAccount,
  makeAccountRepository,
  makeCategoryRepository,
  makeGoalRecord,
  makeGoalRepository,
} from '@modules/goal/test-helpers/goal-factories';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { UpdateGoalRequest } from './update-goal.dto';
import { UpdateGoalService } from './update-goal.service';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';
const DISMISSED_AT = new Date('2026-11-05T09:30:00.000Z');

describe('UpdateGoalService', () => {
  let service: UpdateGoalService;
  let goalRepository: ReturnType<typeof makeGoalRepository>;
  let accountRepository: ReturnType<typeof makeAccountRepository>;
  let categoryRepository: ReturnType<typeof makeCategoryRepository>;

  beforeEach(() => {
    goalRepository = makeGoalRepository();
    accountRepository = makeAccountRepository();
    categoryRepository = makeCategoryRepository();
    goalRepository.findByIdForUpdate.mockResolvedValue(makeGoalRecord());

    service = new UpdateGoalService(
      goalRepository,
      new ValidateGoalLinksService(accountRepository, categoryRepository),
      {
        execute: jest.fn().mockResolvedValue(TIMEZONE),
      } as unknown as GetWorkspaceTimezoneService,
      { now: () => NOW } as unknown as DateProvider,
      new InMemoryCacheProvider(),
    );
  });

  async function applyPatch(
    patch: UpdateGoalRequest,
    current: GoalRecord = makeGoalRecord(),
  ): Promise<UpdateGoalInput> {
    const result = await service.execute({
      id: 'goal-1',
      workspaceId: 'ws-1',
      ...patch,
    });

    if (result.isLeft()) throw result.value;

    const mutate = goalRepository.findByIdForUpdate.mock.calls[0][2];
    const input = mutate(current);

    if (input instanceof Error) throw input;

    return input;
  }

  async function rejectPatch(
    patch: UpdateGoalRequest,
    current: GoalRecord,
  ): Promise<Error> {
    await service.execute({ id: 'goal-1', workspaceId: 'ws-1', ...patch });

    const mutate = goalRepository.findByIdForUpdate.mock.calls[0][2];
    const input = mutate(current);

    if (!(input instanceof Error)) throw new Error('expected an error');

    return input;
  }

  function accountGoal(overrides: Partial<GoalRecord> = {}): GoalRecord {
    return makeGoalRecord({
      progressSource: GoalProgressSource.ACCOUNT,
      linkedAccountId: 'acc-1',
      linkedAccountBalanceCents: 12_345,
      currentCents: 500,
      ...overrides,
    });
  }

  it('patches the goal of the workspace of the token', async () => {
    const result = await service.execute({
      id: 'goal-1',
      workspaceId: 'ws-1',
      name: 'Reserva',
    });

    expect(result.isRight()).toBe(true);
    expect(goalRepository.findByIdForUpdate).toHaveBeenCalledWith(
      'goal-1',
      'ws-1',
      expect.any(Function),
    );
  });

  it('returns 404 without writing when the goal belongs to another workspace', async () => {
    goalRepository.findByIdForUpdate.mockResolvedValue(null);

    const result = await service.execute({
      id: 'goal-1',
      workspaceId: 'ws-2',
      targetCents: 100_000,
    });

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(GoalNotFoundError);
  });

  it('dismissing sets the dismissal instant', async () => {
    const input = await applyPatch({ dismissed: true });

    expect(input.dismissedAt).toEqual(NOW);
  });

  it('un-dismissing clears the dismissal', async () => {
    const input = await applyPatch(
      { dismissed: false },
      makeGoalRecord({ dismissedAt: DISMISSED_AT }),
    );

    expect(input.dismissedAt).toBeNull();
  });

  it('configuring a target wins over an explicit dismissal in the same patch', async () => {
    const input = await applyPatch({ targetCents: 100_000, dismissed: true });

    expect(input.dismissedAt).toBeNull();
  });

  it('configuring a target clears the dismissal', async () => {
    const input = await applyPatch(
      { targetCents: 200_000 },
      makeGoalRecord({ dismissedAt: DISMISSED_AT }),
    );

    expect(input.dismissedAt).toBeNull();
  });

  it('clearing the target keeps the dismissal untouched', async () => {
    const input = await applyPatch(
      { targetCents: 0 },
      makeGoalRecord({ dismissedAt: DISMISSED_AT }),
    );

    expect(input.dismissedAt).toEqual(DISMISSED_AT);
  });

  it('clearing the target of an undismissed goal leaves the invitation visible', async () => {
    const input = await applyPatch({ targetCents: 0 });

    expect(input.dismissedAt).toBeNull();
  });

  it('keeps the dismissal when another field is patched', async () => {
    const input = await applyPatch(
      { currentCents: 50_000 },
      makeGoalRecord({ dismissedAt: DISMISSED_AT }),
    );

    expect(input.dismissedAt).toEqual(DISMISSED_AT);
  });

  it('trims the patched name', async () => {
    const input = await applyPatch({ name: '  Reserva  ' });

    expect(input.name).toBe('Reserva');
  });

  it('rejects an invalid name before writing', async () => {
    const result = await service.execute({
      id: 'goal-1',
      workspaceId: 'ws-1',
      name: '   ',
    });

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(InvalidGoalNameError);
    expect(goalRepository.findByIdForUpdate).not.toHaveBeenCalled();
  });

  it('rejects an invalid linked account before writing', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute({
      id: 'goal-1',
      workspaceId: 'ws-1',
      linkedAccountId: 'missing',
    });

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(GoalLinkedAccountInvalidError);
    expect(goalRepository.findByIdForUpdate).not.toHaveBeenCalled();
  });

  it('unlinks the account when the link is null', async () => {
    const input = await applyPatch({ linkedAccountId: null });

    expect(input.linkedAccountId).toBeNull();
    expect(accountRepository.findById).not.toHaveBeenCalled();
  });

  it('accepts an account of the workspace', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount());

    const result = await service.execute({
      id: 'goal-1',
      workspaceId: 'ws-1',
      linkedAccountId: 'acc-1',
    });

    expect(result.isRight()).toBe(true);
  });

  it('returns the recomputed presentation context', async () => {
    const result = await service.execute({
      id: 'goal-1',
      workspaceId: 'ws-1',
      targetCents: 100_000,
    });

    if (result.isLeft()) throw result.value;
    expect(result.value.now).toEqual(NOW);
    expect(result.value.timezone).toBe(TIMEZONE);
  });

  it('rejects the account source without a resulting link', async () => {
    const error = await rejectPatch(
      { progressSource: GoalProgressSource.ACCOUNT },
      makeGoalRecord(),
    );

    expect(error).toBeInstanceOf(GoalAccountSourceRequiresLinkError);
  });

  it('accepts the account source when the same patch links an account', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount());

    const input = await applyPatch({
      progressSource: GoalProgressSource.ACCOUNT,
      linkedAccountId: 'acc-1',
    });

    expect(input.progressSource).toBe(GoalProgressSource.ACCOUNT);
  });

  it('rejects a typed current amount while the resulting source is account', async () => {
    const error = await rejectPatch({ currentCents: 900 }, accountGoal());

    expect(error).toBeInstanceOf(GoalCurrentTracksAccountError);
  });

  it('never writes the current amount when switching to account', async () => {
    const input = await applyPatch(
      { progressSource: GoalProgressSource.ACCOUNT },
      makeGoalRecord({ linkedAccountId: 'acc-1', currentCents: 700 }),
    );

    expect(input.progressSource).toBe(GoalProgressSource.ACCOUNT);
    expect(input.currentCents).toBeUndefined();
  });

  it('snapshots the balance when switching to manual explicitly', async () => {
    const input = await applyPatch(
      { progressSource: GoalProgressSource.MANUAL },
      accountGoal(),
    );

    expect(input.progressSource).toBe(GoalProgressSource.MANUAL);
    expect(input.currentCents).toBe(12_345);
  });

  it('snapshots the balance and unlinks when the link is cleared', async () => {
    const input = await applyPatch({ linkedAccountId: null }, accountGoal());

    expect(input.progressSource).toBe(GoalProgressSource.MANUAL);
    expect(input.linkedAccountId).toBeNull();
    expect(input.currentCents).toBe(12_345);
  });

  it('snapshots a negative balance as zero', async () => {
    const input = await applyPatch(
      { linkedAccountId: null },
      accountGoal({ linkedAccountBalanceCents: -900 }),
    );

    expect(input.currentCents).toBe(0);
  });

  it('keeps the typed current amount over the snapshot when switching to manual', async () => {
    const input = await applyPatch(
      { progressSource: GoalProgressSource.MANUAL, currentCents: 777 },
      accountGoal(),
    );

    expect(input.progressSource).toBe(GoalProgressSource.MANUAL);
    expect(input.currentCents).toBe(777);
  });

  it('leaves a manual goal untouched by the snapshot rule', async () => {
    const input = await applyPatch(
      { currentCents: 50_000 },
      makeGoalRecord({ linkedAccountId: 'acc-1' }),
    );

    expect(input.currentCents).toBe(50_000);
  });
});
