import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AccountTypeError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import {
  CardCycleBudgetExistsError,
  CardCycleNotConfiguredError,
  HistoricalCardCycleBudgetError,
  InvalidCardCycleLimitError,
} from '@modules/card-cycle/errors';
import {
  CardCycleBudgetRecord,
  CardCycleRepository,
} from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { SaveCardCycleBudgetService } from './save-card-cycle-budget.handler';

const NOW = new Date('2026-11-15T12:00:00.000Z');

function makeCardWithoutDueDay(): CreditCard {
  return CreditCard.reconstitute(
    {
      workspaceId: 'ws-1',
      name: 'My Card',
      timezone: 'America/Sao_Paulo',
      balance: 0n,
      creditLimit: 500_000n,
      closingDaysBeforeDue: 7,
      dueDay: null,
      autoPayEnabled: false,
      autoPayConfirmedAt: null,
      autoPayEnabledAt: null,
      autoPaySourceAccountId: null,
    },
    'acc-1',
  );
}

function makeBudget(
  overrides: Partial<CardCycleBudgetRecord> = {},
): CardCycleBudgetRecord {
  return {
    id: 'budget-1',
    workspaceId: 'ws-1',
    accountId: 'acc-1',
    effectiveFrom: '2026-11-28',
    limitCents: 250_000,
    ...overrides,
  };
}

describe('SaveCardCycleBudgetService', () => {
  let service: SaveCardCycleBudgetService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let cardCycleRepository: jest.Mocked<CardCycleRepository>;
  let dateProvider: DayJsDateProvider;
  let card: CreditCard;

  beforeEach(() => {
    card = makeCreditCard({ dueDay: 28, closingDaysBeforeDue: 7 });

    accountRepository = {
      findById: jest.fn().mockResolvedValue(card),
    } as unknown as jest.Mocked<AccountRepository>;

    cardCycleRepository = {
      materializePeriod: jest.fn(),
      findPeriod: jest.fn(),
      findApplicableBudget: jest.fn(),
      saveBudget: jest.fn().mockResolvedValue(makeBudget()),
      listPeriods: jest.fn(),
      sumCycleSpend: jest.fn(),
    } as unknown as jest.Mocked<CardCycleRepository>;

    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new SaveCardCycleBudgetService(
      accountRepository,
      cardCycleRepository,
      dateProvider,
      new InMemoryCacheProvider(),
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('creates the limit for the current cycle', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-11-28',
      limitCents: 250_000,
    });

    expect(result.isRight()).toBe(true);
    if (!result.isRight()) return;
    expect(result.value).toEqual({
      accountId: 'acc-1',
      effectiveFrom: '2026-11-28',
      limitCents: 250_000,
    });
    expect(cardCycleRepository.saveBudget).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-11-28',
      limitCents: 250_000,
    });
  });

  it('creates the limit for a future cycle in the series', async () => {
    cardCycleRepository.saveBudget.mockResolvedValue(
      makeBudget({ effectiveFrom: '2027-03-28', limitCents: 400_000 }),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2027-03-28',
      limitCents: 400_000,
    });

    expect(result.isRight()).toBe(true);
  });

  it('rejects a cycle before the current one', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-10-28',
      limitCents: 250_000,
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(HistoricalCardCycleBudgetError);
    expect(cardCycleRepository.saveBudget).not.toHaveBeenCalled();
  });

  it('rejects a negative limit', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-11-28',
      limitCents: -1,
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(InvalidCardCycleLimitError);
  });

  it('rejects a fractional limit', async () => {
    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-11-28',
      limitCents: 1000.5,
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(InvalidCardCycleLimitError);
  });

  it('returns the duplicate error and keeps the stored value untouched', async () => {
    cardCycleRepository.saveBudget.mockRejectedValue(
      new CardCycleBudgetExistsError(),
    );

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-11-28',
      limitCents: 900_000,
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(CardCycleBudgetExistsError);
  });

  it('refuses a non card account', async () => {
    accountRepository.findById.mockResolvedValue(makeCheckingAccount());

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-11-28',
      limitCents: 250_000,
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(AccountTypeError);
  });

  it('refuses a card without a due day', async () => {
    accountRepository.findById.mockResolvedValue(makeCardWithoutDueDay());

    const result = await service.execute({
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      effectiveFrom: '2026-11-28',
      limitCents: 250_000,
    });

    expect(result.isLeft()).toBe(true);
    if (!result.isLeft()) return;
    expect(result.value).toBeInstanceOf(CardCycleNotConfiguredError);
  });
});
