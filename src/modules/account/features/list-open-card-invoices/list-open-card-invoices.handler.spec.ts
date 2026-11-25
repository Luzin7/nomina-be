import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { CardInvoiceTotals } from '@modules/account/valueObjects/CardInvoiceWindow';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { GetWorkspaceCycleService } from '@modules/workspace/services/get-workspace-cycle.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
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
  let workspaceCycle: jest.Mocked<GetWorkspaceCycleService>;
  let dateProvider: DayJsDateProvider;

  beforeEach(() => {
    accountRepository = {
      findAllByWorkspaceId: jest.fn(),
    } as unknown as jest.Mocked<AccountRepository>;
    cardInvoiceRepository = {
      findTotals: jest.fn(),
      findPeriodTransactions: jest.fn(),
    } as jest.Mocked<CardInvoiceRepository>;
    workspaceCycle = {
      execute: jest.fn().mockResolvedValue('monthly'),
    } as unknown as jest.Mocked<GetWorkspaceCycleService>;
    dateProvider = new DayJsDateProvider();
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-10-15T12:00:00Z'));
    service = new ListOpenCardInvoicesService(
      accountRepository,
      cardInvoiceRepository,
      workspaceCycle,
      {
        execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
      } as unknown as GetWorkspaceTimezoneService,
      dateProvider,
    );
  });

  it('returns left(WorkspaceNotFoundError) when the workspace is gone', async () => {
    workspaceCycle.execute.mockResolvedValue(null);
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard(),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WorkspaceNotFoundError);
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
      makeTotals(),
      makeTotals(),
    ]);

    await service.execute({ workspaceId: 'ws-1' });

    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledTimes(1);
    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledWith('ws-1', [
      expect.objectContaining({
        accountId: 'card-1',
        periodStart: '2026-09-11',
      }),
      expect.objectContaining({
        accountId: 'card-1',
        periodStart: '2026-10-11',
      }),
      expect.objectContaining({
        accountId: 'card-2',
        periodStart: '2026-09-11',
      }),
      expect.objectContaining({
        accountId: 'card-2',
        periodStart: '2026-10-11',
      }),
    ]);
  });

  it('returns the open invoice of each card from its totals', async () => {
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({ id: 'card-1' }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesInPeriod: 8000n, pendingCharges: 500n }),
      makeTotals(),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.isRight()).toBe(true);
    expect(result.value).toMatchObject({
      invoices: [
        {
          key: '2026-10',
          totalAmount: 8000n,
          previousBalance: 0n,
          statementTotal: 8000n,
          pendingAmount: 500n,
          periodStart: '2026-09-11',
          periodEnd: '2026-10-10',
          dueDate: '2026-10-15',
          invoiceStatus: 'closed',
        },
      ],
    });
  });

  it('keeps the previous cycle invoice while today sits between closing and due date', async () => {
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-25T12:00:00Z'));
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({ id: 'card-1', dueDay: 28, closingDaysBeforeDue: 7 }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesInPeriod: 55000n }),
      makeTotals(),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.value).toMatchObject({
      invoices: [
        {
          key: '2026-11',
          dueDate: '2026-11-28',
          periodStart: '2026-10-22',
          periodEnd: '2026-11-21',
          totalAmount: 55000n,
          invoiceStatus: 'closed',
        },
      ],
    });
  });

  it('falls back to the current invoice once the previous one is settled', async () => {
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-25T12:00:00Z'));
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({ id: 'card-1', dueDay: 28, closingDaysBeforeDue: 7 }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({
        chargesInPeriod: 55000n,
        paymentsAfterClosing: 55000n,
      }),
      makeTotals({ chargesInPeriod: 10000n }),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.value).toMatchObject({
      invoices: [
        {
          key: '2026-12',
          dueDate: '2026-12-28',
          periodStart: '2026-11-22',
          periodEnd: '2026-12-21',
          totalAmount: 10000n,
          invoiceStatus: 'current',
        },
      ],
    });
  });

  it('falls back to the current invoice when the previous key carries no charges', async () => {
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-25T12:00:00Z'));
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({ id: 'card-1', dueDay: 28, closingDaysBeforeDue: 7 }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals(),
      makeTotals(),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.value).toMatchObject({
      invoices: [
        {
          key: '2026-12',
          dueDate: '2026-12-28',
          totalAmount: 0n,
          invoiceStatus: 'current',
        },
      ],
    });
  });

  it('keeps the current invoice while today is still before its closing', async () => {
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-20T12:00:00Z'));
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({ id: 'card-1', dueDay: 28, closingDaysBeforeDue: 7 }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesInPeriod: 55000n }),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.value).toMatchObject({
      invoices: [
        {
          dueDate: '2026-11-28',
          periodStart: '2026-10-22',
          periodEnd: '2026-11-21',
          totalAmount: 55000n,
          invoiceStatus: 'current',
        },
      ],
    });
  });

  it('keeps the current invoice even before any charge lands', async () => {
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-20T12:00:00Z'));
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({ id: 'card-1', dueDay: 28, closingDaysBeforeDue: 7 }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([makeTotals()]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.value).toMatchObject({
      invoices: [
        {
          key: '2026-11',
          dueDate: '2026-11-28',
          totalAmount: 0n,
          invoiceStatus: 'current',
        },
      ],
    });
  });

  it('resolves the card key from the workspace day, not the card day', async () => {
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-22T02:00:00Z'));
    accountRepository.findAllByWorkspaceId.mockResolvedValue([
      makeCreditCard({
        id: 'card-1',
        dueDay: 28,
        closingDaysBeforeDue: 7,
        timezone: 'Pacific/Kiritimati',
      }),
    ]);
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesInPeriod: 55000n }),
    ]);

    const result = await service.execute({ workspaceId: 'ws-1' });

    expect(result.value).toMatchObject({
      invoices: [
        {
          key: '2026-11',
          dueDate: '2026-11-28',
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
