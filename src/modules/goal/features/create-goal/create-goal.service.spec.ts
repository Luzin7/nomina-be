import { AccountType } from '@constants/enums';
import {
  GoalCategoryInvalidError,
  GoalLinkedAccountInvalidError,
  InvalidGoalNameError,
} from '@modules/goal/errors';
import { ValidateGoalLinksService } from '@modules/goal/services/validate-goal-links.service';
import {
  makeAccount,
  makeAccountRepository,
  makeCategory,
  makeCategoryRepository,
  makeGoalRecord,
  makeGoalRepository,
} from '@modules/goal/test-helpers/goal-factories';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { CreateGoalService } from './create-goal.service';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';

function makeRequest(overrides = {}) {
  return {
    workspaceId: 'ws-1',
    name: 'Viagem',
    targetCents: 600_000,
    ...overrides,
  };
}

describe('CreateGoalService', () => {
  let service: CreateGoalService;
  let goalRepository: ReturnType<typeof makeGoalRepository>;
  let accountRepository: ReturnType<typeof makeAccountRepository>;
  let categoryRepository: ReturnType<typeof makeCategoryRepository>;

  beforeEach(() => {
    goalRepository = makeGoalRepository();
    accountRepository = makeAccountRepository();
    categoryRepository = makeCategoryRepository();
    goalRepository.create.mockImplementation(async (input) =>
      makeGoalRecord({ ...input, id: 'goal-new' }),
    );
    categoryRepository.findById.mockResolvedValue(makeCategory());

    service = new CreateGoalService(
      goalRepository,
      new ValidateGoalLinksService(accountRepository, categoryRepository),
      {
        execute: jest.fn().mockResolvedValue(TIMEZONE),
      } as unknown as GetWorkspaceTimezoneService,
      { now: () => NOW } as unknown as DateProvider,
    );
  });

  it('creates a configured goal owned by the workspace of the token', async () => {
    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    expect(goalRepository.create).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'Viagem',
      targetCents: 600_000,
      currentCents: 0,
      monthlyAporteCents: 0,
      linkedAccountId: null,
      categoryId: null,
    });
    if (result.isLeft()) throw result.value;
    expect(result.value.goal.configured).toBe(true);
    expect(result.value.now).toEqual(NOW);
    expect(result.value.timezone).toBe(TIMEZONE);
  });

  it('trims the name before writing', async () => {
    await service.execute(makeRequest({ name: '  Viagem  ' }));

    expect(goalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Viagem' }),
    );
  });

  it('rejects a name that is empty after trim', async () => {
    const result = await service.execute(makeRequest({ name: '   ' }));

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(InvalidGoalNameError);
    expect(goalRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a name longer than 60 characters', async () => {
    const result = await service.execute(makeRequest({ name: 'a'.repeat(61) }));

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(InvalidGoalNameError);
  });

  it('rejects a linked account of another workspace', async () => {
    accountRepository.findById.mockResolvedValue(
      makeAccount({ workspaceId: 'ws-2' }),
    );

    const result = await service.execute(
      makeRequest({ linkedAccountId: 'acc-2' }),
    );

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(GoalLinkedAccountInvalidError);
    expect(goalRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a credit card as linked account', async () => {
    accountRepository.findById.mockResolvedValue(
      makeAccount({ type: AccountType.CREDIT_CARD }),
    );

    const result = await service.execute(
      makeRequest({ linkedAccountId: 'card-1' }),
    );

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(GoalLinkedAccountInvalidError);
  });

  it('rejects an unknown linked account', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(
      makeRequest({ linkedAccountId: 'missing' }),
    );

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(GoalLinkedAccountInvalidError);
  });

  it('rejects a category of another workspace', async () => {
    categoryRepository.findById.mockResolvedValue(
      makeCategory({ workspaceId: 'ws-2' }),
    );

    const result = await service.execute(makeRequest({ categoryId: 'cat-2' }));

    if (result.isRight()) throw new Error('expected an error');
    expect(result.value).toBeInstanceOf(GoalCategoryInvalidError);
  });

  it('accepts a system category as the goal category', async () => {
    categoryRepository.findById.mockResolvedValue(
      makeCategory({ workspaceId: null }),
    );

    const result = await service.execute(makeRequest({ categoryId: 'cat-1' }));

    expect(result.isRight()).toBe(true);
  });
});
