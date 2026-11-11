import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { AccountTypeError } from '@modules/account/errors';
import {
  CardCyclePeriodRecord,
  CardCycleRepository,
} from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { GetCardCyclePeriodsService } from './get-card-cycle-periods.handler';

function makePeriod(
  overrides: Partial<CardCyclePeriodRecord> = {},
): CardCyclePeriodRecord {
  return {
    id: 'period-1',
    workspaceId: 'ws-1',
    accountId: 'acc-1',
    dueDate: '2026-11-28',
    periodStart: '2026-10-22',
    periodEnd: '2026-11-21',
    dueDay: 28,
    closingDaysBeforeDue: 7,
    materializedAt: new Date('2026-11-20T12:00:00.000Z'),
    ...overrides,
  };
}

describe('GetCardCyclePeriodsService', () => {
  let service: GetCardCyclePeriodsService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let cardCycleRepository: jest.Mocked<CardCycleRepository>;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn().mockResolvedValue(makeCreditCard()),
    } as unknown as jest.Mocked<AccountRepository>;

    cardCycleRepository = {
      materializePeriod: jest.fn(),
      findPeriod: jest.fn(),
      findApplicableBudget: jest.fn(),
      saveBudget: jest.fn(),
      listPeriods: jest.fn().mockResolvedValue([makePeriod()]),
      sumCycleSpend: jest.fn(),
    } as unknown as jest.Mocked<CardCycleRepository>;

    service = new GetCardCyclePeriodsService(
      accountRepository,
      cardCycleRepository,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('lists the materialized windows with the requested limit', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      limit: 12,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value).toEqual([makePeriod()]);
    expect(cardCycleRepository.listPeriods).toHaveBeenCalledWith(
      'ws-1',
      'acc-1',
      12,
    );
  });

  it('refuses a non card account', async () => {
    accountRepository.findById.mockResolvedValue(makeCheckingAccount());

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      limit: 12,
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(AccountTypeError);
  });

  it('lists both overlapping windows as history, newest due date first', async () => {
    const newDueDayPeriod = makePeriod({
      id: 'period-new',
      dueDate: '2026-12-10',
      periodStart: '2026-11-04',
      periodEnd: '2026-12-03',
      dueDay: 10,
    });
    const frozenOldPeriod = makePeriod({
      id: 'period-old',
      dueDate: '2026-11-28',
      periodStart: '2026-10-22',
      periodEnd: '2026-11-21',
      dueDay: 28,
    });
    cardCycleRepository.listPeriods.mockResolvedValue([
      newDueDayPeriod,
      frozenOldPeriod,
    ]);

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      limit: 12,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value.map((period) => period.dueDate)).toEqual([
      '2026-12-10',
      '2026-11-28',
    ]);
    expect(result.value).toEqual([newDueDayPeriod, frozenOldPeriod]);
    expect(cardCycleRepository.materializePeriod).not.toHaveBeenCalled();
  });
});
