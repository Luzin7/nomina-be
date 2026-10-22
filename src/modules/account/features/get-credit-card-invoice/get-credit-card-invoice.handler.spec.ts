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
  makeTransaction,
} from '@modules/transaction/test-helpers/mock-factories';
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

const middayOf = (date: string) => new Date(`${date}T12:00:00Z`);

const chargeOn = (date: string, amount: bigint) =>
  makeCompletedCharge(amount, { date: middayOf(date) });

const paymentOn = (date: string, amount: bigint) =>
  makeCompletedPayment(amount, { date: middayOf(date) });

describe('GetCreditCardInvoiceService', () => {
  let service: GetCreditCardInvoiceService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let dateProvider: DayJsDateProvider;

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
      updateWithBalanceEffect: jest.fn(),
      deleteWithBalanceEffect: jest.fn(),
      toggleStatusWithBalanceEffect: jest.fn(),
      findCreditCardLedger: jest.fn().mockResolvedValue([]),
    } as jest.Mocked<TransactionRepository>;

    dateProvider = new DayJsDateProvider();
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-10-15T12:00:00Z'));

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

    expect(transactionRepository.findCreditCardLedger).toHaveBeenCalledWith(
      'acc-1',
      'ws-1',
    );
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
    transactionRepository.findCreditCardLedger.mockResolvedValue([
      chargeOn('2026-09-20', 5000n),
      chargeOn('2026-09-21', 5000n),
      paymentOn('2026-10-12', 3000n),
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
    transactionRepository.findCreditCardLedger.mockResolvedValue([
      chargeOn('2026-09-20', 5000n),
      paymentOn('2026-10-12', 9000n),
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
    transactionRepository.findCreditCardLedger.mockResolvedValue([
      chargeOn('2026-08-20', 5000n),
      paymentOn('2026-09-12', 5000n),
    ]);

    const result = await service.execute(makeRequest({ month: 9, year: 2026 }));

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.invoiceStatus).toBe('paid');
    }
  });

  it('should credit an advance payment to the invoice whose period contains it, whatever its tag', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findCreditCardLedger.mockResolvedValue([
      chargeOn('2026-08-20', 1000n),
      paymentOn('2026-09-12', 1000n),
      chargeOn('2026-09-20', 600n),
      makeCompletedPayment(300n, {
        date: middayOf('2026-09-25'),
        invoicePeriodMonth: 9,
        invoicePeriodYear: 2026,
      }),
    ]);

    const result = await service.execute(
      makeRequest({ month: 10, year: 2026 }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.previousBalance).toBe(1000n);
      expect(result.value.statementTotal).toBe(300n);
      expect(result.value.totalAmount).toBe(300n);
    }
  });

  it('should count an income on the card as a credit', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findCreditCardLedger.mockResolvedValue([
      chargeOn('2026-09-20', 1000n),
      makeTransaction({
        accountId: 'acc-1',
        type: 'INCOME',
        amount: 400n,
        date: middayOf('2026-09-22'),
      }),
    ]);

    const result = await service.execute(
      makeRequest({ month: 10, year: 2026 }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.totalAmount).toBe(600n);
    }
  });

  it('should list only the transactions dated within the invoice period', async () => {
    const charge = chargeOn('2026-09-20', 600n);
    const payment = paymentOn('2026-09-25', 300n);
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findCreditCardLedger.mockResolvedValue([
      chargeOn('2026-08-20', 1000n),
      charge,
      payment,
      paymentOn('2026-10-12', 300n),
    ]);

    const result = await service.execute(
      makeRequest({ month: 10, year: 2026 }),
    );

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.transactions).toEqual([charge, payment]);
    }
  });

  it('should not let availableLimit go negative when pending exceeds remaining limit', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ creditLimit: 10000n }),
    );
    transactionRepository.findCreditCardLedger.mockResolvedValue([
      chargeOn('2026-10-12', 8000n),
      makeCompletedCharge(6000n, {
        date: middayOf('2026-10-20'),
        status: TransactionStatus.PENDING,
      }),
    ]);

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.pendingAmount).toBe(6000n);
      expect(result.value.availableLimit).toBe(0n);
    }
  });
});
