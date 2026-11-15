import { ListAccountsService } from '@modules/account/features/list-accounts/list-accounts.service';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import { makeCreditCard } from '@modules/account/test-helpers/mock-factories';
import { CardInvoiceTotals } from '@modules/account/valueObjects/CardInvoiceWindow';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { right } from '@shared/core/errors/Either';
import { CardBillDueInsightService } from './card-bill-due-insight.service';

const TODAY = '2026-11-15';
const REQUEST = { workspaceId: 'ws-1', sub: 'user-1', today: TODAY };

const makeTotals = (
  overrides: Partial<CardInvoiceTotals> = {},
): CardInvoiceTotals => ({
  chargesBeforePeriod: 0n,
  paymentsBeforePeriod: 0n,
  chargesInPeriod: 10_000n,
  paymentsInPeriod: 0n,
  paymentsAfterClosing: 0n,
  pendingCharges: 0n,
  ...overrides,
});

describe('CardBillDueInsightService', () => {
  let service: CardBillDueInsightService;
  let listAccounts: jest.Mocked<ListAccountsService>;
  let cardInvoiceRepository: jest.Mocked<CardInvoiceRepository>;

  const givenCards = (...cards: unknown[]) =>
    listAccounts.execute.mockResolvedValue(
      right({
        accounts: cards.map((account) => ({ account, balanceUpdatedAt: null })),
        total: cards.length,
      } as never),
    );

  beforeEach(() => {
    listAccounts = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ListAccountsService>;
    cardInvoiceRepository = {
      findTotals: jest.fn(),
      findPeriodTransactions: jest.fn(),
    } as jest.Mocked<CardInvoiceRepository>;
    const dateProvider = new DayJsDateProvider();
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-15T12:00:00.000Z'));
    service = new CardBillDueInsightService(
      listAccounts,
      cardInvoiceRepository,
      dateProvider,
    );
  });

  it('reads the totals of three due cards in one repository call', async () => {
    givenCards(
      makeCreditCard({ id: 'a', name: 'A', dueDay: 16 }),
      makeCreditCard({ id: 'b', name: 'B', dueDay: 17 }),
      makeCreditCard({ id: 'c', name: 'C', dueDay: 18 }),
    );
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals(),
      makeTotals(),
      makeTotals(),
    ]);

    await service.execute(REQUEST);

    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledTimes(1);
    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledWith('ws-1', [
      expect.objectContaining({ accountId: 'a', today: TODAY }),
      expect.objectContaining({ accountId: 'b', today: TODAY }),
      expect.objectContaining({ accountId: 'c', today: TODAY }),
    ]);
  });

  it('picks the nearest card that still owes', async () => {
    givenCards(
      makeCreditCard({ id: 'a', name: 'A', dueDay: 16 }),
      makeCreditCard({ id: 'b', name: 'B', dueDay: 17 }),
    );
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ paymentsInPeriod: 10_000n }),
      makeTotals(),
    ]);

    const insight = await service.execute(REQUEST);

    expect(insight?.args).toEqual({ cardId: 'b', cardName: 'B', days: 2 });
  });

  it('does not query when no card is due in the window', async () => {
    givenCards(makeCreditCard({ id: 'a', name: 'A', dueDay: 28 }));

    const insight = await service.execute(REQUEST);

    expect(insight).toBeNull();
    expect(cardInvoiceRepository.findTotals).not.toHaveBeenCalled();
  });

  it('uses the date of each card timezone as today', async () => {
    jest
      .spyOn(DayJsDateProvider.prototype, 'now')
      .mockReturnValue(new Date('2026-11-15T02:30:00.000Z'));
    service = new CardBillDueInsightService(
      listAccounts,
      cardInvoiceRepository,
      new DayJsDateProvider(),
    );
    givenCards(
      makeCreditCard({
        id: 'recife',
        dueDay: 16,
        timezone: 'America/Recife',
      }),
      makeCreditCard({ id: 'utc', dueDay: 17, timezone: 'UTC' }),
    );
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals(),
      makeTotals(),
    ]);

    await service.execute(REQUEST);

    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledWith('ws-1', [
      expect.objectContaining({ accountId: 'recife', today: '2026-11-14' }),
      expect.objectContaining({ accountId: 'utc', today: '2026-11-15' }),
    ]);
  });
});
