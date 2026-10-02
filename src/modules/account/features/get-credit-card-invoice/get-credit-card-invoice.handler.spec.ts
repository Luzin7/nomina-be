import { TransactionStatus } from '@constants/enums';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import {
  makeCompletedCharge,
  makeCompletedPayment,
} from '@modules/transaction/test-helpers/mock-factories';
import { DateProvider } from '@providers/date/contracts/DateProvider';
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

describe('GetCreditCardInvoiceService', () => {
  let service: GetCreditCardInvoiceService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

  const today = '2026-10-15';

  beforeEach(() => {
    accountRepository = {
      findByNameAndWorkspaceId: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    transactionRepository = {
      create: jest.fn(),
      findUniqueById: jest.fn(),
      listTransactionsByWorkspaceId: jest.fn(),
      getTopExpensesByCategory: jest.fn(),
      sumTransactionsByDateRange: jest.fn(),
      createWithBalanceUpdate: jest.fn(),
      updateWithBalanceUpdate: jest.fn(),
      deleteWithBalanceReversion: jest.fn(),
      toggleStatusWithBalanceUpdate: jest.fn(),
      findChargesByPeriod: jest.fn(),
      findPaymentsByInvoice: jest.fn(),
    } as jest.Mocked<TransactionRepository>;

    dateProvider = {
      now: jest.fn().mockReturnValue(new Date('2026-10-15T12:00:00Z')),
      add: jest.fn(),
      format: jest.fn().mockReturnValue(today),
      toTimezone: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn((date: string | Date) => new Date(String(date))),
      endOfDay: jest.fn((date: string | Date) => new Date(String(date))),
      startOfMonth: jest.fn(),
      endOfMonth: jest.fn(),
    } as unknown as jest.Mocked<DateProvider>;

    service = new GetCreditCardInvoiceService(
      accountRepository,
      transactionRepository,
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

  it('should return the current invoice data on success', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findChargesByPeriod.mockResolvedValue([]);
    transactionRepository.findPaymentsByInvoice.mockResolvedValue([]);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.account).toBeInstanceOf(CreditCard);
      expect(result.value.transactions).toEqual([]);
      expect(result.value.totalAmount).toBe(0);
      expect(result.value.periodStart).toBe('2026-10-11');
      expect(result.value.periodEnd).toBe('2026-11-10');
      expect(result.value.dueDate).toBe('2026-11-15');
      expect(result.value.invoiceStatus).toBe('current');
    }

    expect(transactionRepository.findChargesByPeriod).toHaveBeenCalledWith(
      'acc-1',
      'ws-1',
      new Date('2026-10-11'),
      new Date('2026-11-11'),
    );
  });

  it('should resolve a requested invoice by its due month', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findChargesByPeriod.mockResolvedValue([]);
    transactionRepository.findPaymentsByInvoice.mockResolvedValue([]);

    const result = await service.execute(makeRequest({ month: 9, year: 2026 }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.periodStart).toBe('2026-08-11');
      expect(result.value.periodEnd).toBe('2026-09-10');
      expect(result.value.dueDate).toBe('2026-09-15');
      expect(result.value.invoiceStatus).toBe('overdue');
    }

    expect(transactionRepository.findPaymentsByInvoice).toHaveBeenCalledWith(
      'acc-1',
      'ws-1',
      {
        month: 9,
        year: 2026,
        untaggedWindow: {
          startExclusive: expect.any(Date),
          endInclusive: expect.any(Date),
        },
      },
    );
  });

  it('should subtract completed payments made toward this invoice from totalAmount', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findChargesByPeriod.mockResolvedValue([
      makeCompletedCharge(5000n),
      makeCompletedCharge(5000n),
    ]);
    transactionRepository.findPaymentsByInvoice.mockResolvedValue([
      makeCompletedPayment(3000n),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.totalAmount).toBe(7000);
    }
  });

  it('should not let totalAmount go negative when payments exceed charges', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findChargesByPeriod.mockResolvedValue([
      makeCompletedCharge(5000n),
    ]);
    transactionRepository.findPaymentsByInvoice.mockResolvedValue([
      makeCompletedPayment(9000n),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.totalAmount).toBe(0);
    }
  });

  it('should mark the invoice as paid when completed payments settle the charges', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findChargesByPeriod.mockResolvedValue([
      makeCompletedCharge(5000n),
    ]);
    transactionRepository.findPaymentsByInvoice.mockResolvedValue([
      makeCompletedPayment(5000n),
    ]);

    const result = await service.execute(makeRequest({ month: 9, year: 2026 }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.invoiceStatus).toBe('paid');
    }
  });

  it('should not let availableLimit go negative when pending exceeds remaining limit', async () => {
    const card = makeCreditCard();
    Object.defineProperty(card, 'creditLimit', { value: 10000n });
    accountRepository.findById.mockResolvedValue(card);

    const charge = makeCompletedCharge(8000n);
    const pending = makeCompletedCharge(1000n);
    Object.defineProperty(pending, 'status', {
      value: TransactionStatus.PENDING,
    });
    Object.defineProperty(pending, 'amount', { value: 6000n });

    transactionRepository.findChargesByPeriod.mockResolvedValue([
      charge,
      pending,
    ]);
    transactionRepository.findPaymentsByInvoice.mockResolvedValue([]);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.availableLimit).toBe(0);
    }
  });
});
