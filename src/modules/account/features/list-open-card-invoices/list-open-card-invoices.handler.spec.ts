import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { CardInvoiceTotals } from '@modules/account/valueObjects/CardInvoiceWindow';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { ListOpenCardInvoicesService } from './list-open-card-invoices.handler';

const makeTotals = (
  overrides: Partial<CardInvoiceTotals> = {},
): CardInvoiceTotals => ({
  chargesBeforePeriod: 0n,
  paymentsBeforePeriod: 0n,
  chargesInPeriod: 0n,
  paymentsInPeriod: 0n,
  paymentsAfterClosing: 0n,
  pendingCharges: 0n,
  ...overrides,
});

describe('ListOpenCardInvoicesService', () => {
  let service: ListOpenCardInvoicesService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let cardInvoiceRepository: jest.Mocked<CardInvoiceRepository>;

  beforeEach(() => {
    accountRepository = {
      findAllByWorkspaceId: jest.fn(),
    } as unknown as jest.Mocked<AccountRepository>;
    cardInvoiceRepository = {
      findTotals: jest.fn(),
      findPeriodTransactions: jest.fn(),
    } as jest.Mocked<CardInvoiceRepository>;
    const dateProvider = new DayJsDateProvider();
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-10-15T12:00:00Z'));
    service = new ListOpenCardInvoicesService(
      accountRepository,
      cardInvoiceRepository,
      dateProvider,
    );
  });

  it('reads the totals of every card in one repository call', async () => {
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({ id: 'card-1' }),
      makeCheckingAccount(),
      makeCreditCard({ id: 'card-2' }),
      makeCreditCard({ id: 'card-3', dueDay: null }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals(),
      makeTotals(),
    ]);

    await service.execute({ workspaceId: 'ws-1' });

    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledTimes(1);
    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledWith('ws-1', [
      expect.objectContaining({ accountId: 'card-1' }),
      expect.objectContaining({ accountId: 'card-2' }),
    ]);
  });

  it('returns the current invoice of each card from its totals', async () => {
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({ id: 'card-1' }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesInPeriod: 8000n, pendingCharges: 500n }),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    expect(result.value).toMatchObject({
      invoices: [
        {
          totalAmount: 8000n,
          previousBalance: 0n,
          statementTotal: 8000n,
          pendingAmount: 500n,
          periodStart: '2026-10-11',
          periodEnd: '2026-11-10',
          dueDate: '2026-11-15',
          invoiceStatus: 'current',
        },
      ],
    });
  });

  it('does not query when the workspace has no card with a cycle', async () => {
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCheckingAccount(),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.value).toEqual({ invoices: [] });
    expect(cardInvoiceRepository.findTotals).not.toHaveBeenCalled();
  });
});
