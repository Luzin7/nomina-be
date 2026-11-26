import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
  CreditCardCycleNotConfiguredError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CardInvoiceRepository } from '@modules/account/repositories/contracts/CardInvoiceRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { CardInvoiceTotals } from '@modules/account/valueObjects/CardInvoiceWindow';
import { makeCompletedCharge } from '@modules/transaction/test-helpers/mock-factories';
import { WorkspaceNotFoundError } from '@modules/workspace/errors';
import { GetWorkspaceCycleService } from '@modules/workspace/services/get-workspace-cycle.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { GetCreditCardInvoiceService } from './get-credit-card-invoice.handler';

type ServiceRequest = Parameters<
  typeof GetCreditCardInvoiceService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    accountId: 'acc-1',
    sub: 'user-1',
    workspaceId: 'ws-1',
    ...overrides,
  } as ServiceRequest;
}

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

describe('GetCreditCardInvoiceService', () => {
  let service: GetCreditCardInvoiceService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let cardInvoiceRepository: jest.Mocked<CardInvoiceRepository>;
  let workspaceCycle: jest.Mocked<GetWorkspaceCycleService>;
  let dateProvider: DayJsDateProvider;

  beforeEach(() => {
    accountRepository = {
      findByNameAndWorkspaceId: jest.fn(),
      create: jest.fn(),
      createWithOpeningMovement: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      findLastMovementsByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
      updateAutoPay: jest.fn(),
      adjustBalance: jest.fn(),
      listBalanceAdjustments: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    cardInvoiceRepository = {
      findTotals: jest.fn().mockResolvedValue([makeTotals(), makeTotals()]),
      findPeriodTransactions: jest.fn().mockResolvedValue([]),
    } as jest.Mocked<CardInvoiceRepository>;

    dateProvider = new DayJsDateProvider();
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-10-15T12:00:00Z'));
    workspaceCycle = {
      execute: jest.fn().mockResolvedValue('monthly'),
    } as unknown as jest.Mocked<GetWorkspaceCycleService>;

    service = new GetCreditCardInvoiceService(
      accountRepository,
      cardInvoiceRepository,
      workspaceCycle,
      {
        execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
      } as unknown as GetWorkspaceTimezoneService,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(AccountNotFoundError) when account not found', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(AccountNotFoundError);
  });

  it('should return left(WorkspaceNotFoundError) when the workspace is gone', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    workspaceCycle.execute.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('should return left(UnauthorizedError) when account belongs to different workspace', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ workspaceId: 'ws-other' }),
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left(AccountTypeError) when account is not a credit card', async () => {
    accountRepository.findById.mockResolvedValue(makeCheckingAccount());

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(AccountTypeError);
  });

  it('should return left(CreditCardCycleNotConfiguredError) when the card has no dueDay', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ dueDay: null }),
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(CreditCardCycleNotConfiguredError);
  });

  it('should return the open invoice data on success', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.account).toBeInstanceOf(CreditCard);
      expect(result.value.transactions).toEqual([]);
      expect(result.value.totalAmount).toBe(0n);
      expect(result.value.periodStart).toBe('2026-10-11');
      expect(result.value.periodEnd).toBe('2026-11-10');
      expect(result.value.dueDate).toBe('2026-11-15');
      expect(result.value.invoiceStatus).toBe('current');
    }

    expect(cardInvoiceRepository.findTotals).toHaveBeenCalledWith('ws-1', [
      {
        accountId: 'acc-1',
        timezone: 'America/Sao_Paulo',
        periodStart: '2026-09-11',
        periodEnd: '2026-10-10',
        today: '2026-10-15',
      },
      {
        accountId: 'acc-1',
        timezone: 'America/Sao_Paulo',
        periodStart: '2026-10-11',
        periodEnd: '2026-11-10',
        today: '2026-10-15',
      },
    ]);
  });

  it('should resolve the previous cycle invoice while today sits between closing and due date', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ dueDay: 28, closingDaysBeforeDue: 7 }),
    );
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-25T12:00:00Z'));
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesInPeriod: 55000n }),
      makeTotals(),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.dueDate).toBe('2026-11-28');
      expect(result.value.periodStart).toBe('2026-10-22');
      expect(result.value.periodEnd).toBe('2026-11-21');
      expect(result.value.dueMonth).toBe(11);
      expect(result.value.dueYear).toBe(2026);
      expect(result.value.invoiceStatus).toBe('closed');
    }
  });

  it('should fall back to the current invoice once the previous one is settled', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ dueDay: 28, closingDaysBeforeDue: 7 }),
    );
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-11-25T12:00:00Z'));
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({
        chargesInPeriod: 55000n,
        paymentsAfterClosing: 55000n,
      }),
      makeTotals({ chargesInPeriod: 2000n }),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.dueDate).toBe('2026-12-28');
      expect(result.value.dueMonth).toBe(12);
      expect(result.value.totalAmount).toBe(2000n);
      expect(result.value.invoiceStatus).toBe('current');
    }
  });

  it('should resolve a requested invoice by its due month', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());

    const result = await service.execute(makeRequest({ month: 9, year: 2026 }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.periodStart).toBe('2026-08-11');
      expect(result.value.periodEnd).toBe('2026-09-10');
      expect(result.value.dueDate).toBe('2026-09-15');
      expect(result.value.invoiceStatus).toBe('overdue');
    }
  });

  it('should subtract payments made after the closing from totalAmount', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesBeforePeriod: 10000n, paymentsAfterClosing: 3000n }),
    ]);

    const result = await service.execute(
      makeRequest({ month: 10, year: 2026 }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.totalAmount).toBe(7000n);
    }
  });

  it('should not let totalAmount go negative when payments exceed charges', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesBeforePeriod: 5000n, paymentsAfterClosing: 9000n }),
    ]);

    const result = await service.execute(
      makeRequest({ month: 10, year: 2026 }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.totalAmount).toBe(0n);
    }
  });

  it('should mark the invoice as paid when payments settle it', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({ chargesBeforePeriod: 5000n, paymentsInPeriod: 5000n }),
    ]);

    const result = await service.execute(makeRequest({ month: 9, year: 2026 }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.invoiceStatus).toBe('paid');
    }
  });

  it('should build the statement from the totals', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    cardInvoiceRepository.findTotals.mockResolvedValue([
      makeTotals({
        chargesBeforePeriod: 1000n,
        paymentsBeforePeriod: 1000n,
        chargesInPeriod: 600n,
        paymentsInPeriod: 300n,
      }),
    ]);

    const result = await service.execute(
      makeRequest({ month: 10, year: 2026 }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.previousBalance).toBe(0n);
      expect(result.value.statementTotal).toBe(300n);
      expect(result.value.totalAmount).toBe(300n);
    }
  });

  it('should return the period transactions from the repository', async () => {
    const charge = makeCompletedCharge(600n);
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    cardInvoiceRepository.findPeriodTransactions.mockResolvedValue([charge]);

    const result = await service.execute(
      makeRequest({ month: 10, year: 2026 }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.transactions).toEqual([charge]);
    }
  });

  it('should return a signed availableLimit for an over-limit card', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ creditLimit: 10000n, balance: 14000n }),
    );

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.availableLimit).toBe(-4000n);
    }
  });
});
