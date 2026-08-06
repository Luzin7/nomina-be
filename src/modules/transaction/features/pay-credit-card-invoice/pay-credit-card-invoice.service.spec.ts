import { AccountType, TransactionStatus } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
    AccountNotFoundError,
    InvalidAccountError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
    CannotPayInvoiceWithCreditCardError,
    SourceAndDestinationAccountMustBeDifferentError,
} from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { PayCreditCardInvoiceService } from './pay-credit-card-invoice.service';

type ServiceRequest = Parameters<
  typeof PayCreditCardInvoiceService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    creditCardAccountId: 'acc-cc',
    sourceAccountId: 'acc-src',
    amount: 1000,
    workspaceId: 'ws-1',
    sub: 'user-1',
    name: 'User',
    role: 'USER',
    ...overrides,
  } as ServiceRequest;
}

function makeCreditCard(workspaceId = 'ws-1'): CreditCard {
  const r = CreditCard.create(
    {
      workspaceId,
      name: 'My Card',
      timezone: 'UTC',
      creditLimit: 500000n,
      closingDaysBeforeDue: 5,
      dueDay: 15,
      balance: 100000n,
    },
    'acc-cc',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

function makeCheckingAccount(workspaceId = 'ws-1'): CheckingAccount {
  const r = CheckingAccount.create(
    {
      workspaceId,
      name: 'Checking',
      timezone: 'UTC',
      type: AccountType.CHECKING,
      balance: 100000n,
    },
    'acc-src',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

describe('PayCreditCardInvoiceService', () => {
  let service: PayCreditCardInvoiceService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

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
      findByAccountAndDateRange: jest.fn(),
    } as jest.Mocked<TransactionRepository>;

    dateProvider = {
      now: jest.fn().mockReturnValue(new Date()),
      startOfDay: jest.fn().mockReturnValue(new Date()),
      add: jest.fn(),
      format: jest.fn(),
      toTimezone: jest.fn(),
      calculateInvoiceCycle: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
    } as unknown as jest.Mocked<DateProvider>;

    service = new PayCreditCardInvoiceService(
      accountRepository,
      transactionRepository,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(AccountNotFoundError) when credit card not found', async () => {
    accountRepository.findById.mockResolvedValue(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(AccountNotFoundError);
  });

  it('should return left(InvalidAccountError) when destination is not a credit card', async () => {
    accountRepository.findById.mockResolvedValue(makeCheckingAccount());

    const result = await service.execute(
      makeRequest({ creditCardAccountId: 'acc-cc' }),
    );
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(InvalidAccountError);
  });

  it('should return left(SourceAndDestinationAccountMustBeDifferentError) when source equals destination', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());

    const result = await service.execute(
      makeRequest({ sourceAccountId: 'acc-cc' }),
    );
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(
      SourceAndDestinationAccountMustBeDifferentError,
    );
  });

  it('should return left(AccountNotFoundError) when source account not found', async () => {
    accountRepository.findById
      .mockResolvedValueOnce(makeCreditCard())
      .mockResolvedValueOnce(null);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(AccountNotFoundError);
  });

  it('should return left(CannotPayInvoiceWithCreditCardError) when source is a credit card', async () => {
    const cc2 = CreditCard.create(
      {
        workspaceId: 'ws-1',
        name: 'Another CC',
        timezone: 'UTC',
        creditLimit: 100000n,
        closingDaysBeforeDue: 10,
        dueDay: 20,
      },
      'acc-src',
    );
    if (cc2.isLeft()) throw cc2.value;

    accountRepository.findById
      .mockResolvedValueOnce(makeCreditCard())
      .mockResolvedValueOnce(cc2.value);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(CannotPayInvoiceWithCreditCardError);
  });

  it('should create a TRANSFER transaction and persist on success', async () => {
    accountRepository.findById
      .mockResolvedValueOnce(makeCreditCard())
      .mockResolvedValueOnce(makeCheckingAccount());
    transactionRepository.createWithBalanceUpdate.mockResolvedValue();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.type).toBe('TRANSFER');
      expect(result.value.status).toBe(TransactionStatus.COMPLETED);
    }
    expect(transactionRepository.createWithBalanceUpdate).toHaveBeenCalledTimes(
      1,
    );
  });

  it('should date the payment as today when month/year are not provided', async () => {
    const today = new Date('2024-08-05');
    dateProvider.now.mockReturnValue(today);
    dateProvider.startOfDay.mockReturnValue(today);
    accountRepository.findById
      .mockResolvedValueOnce(makeCreditCard())
      .mockResolvedValueOnce(makeCheckingAccount());
    transactionRepository.createWithBalanceUpdate.mockResolvedValue();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.date).toEqual(today);
    }
    expect(dateProvider.calculateInvoiceCycle).not.toHaveBeenCalled();
  });

  it('should anchor the payment date to the end of a closed invoice cycle when month/year target a past period', async () => {
    // Regressão do bug: pagar em agosto a fatura de julho não podia usar
    // "hoje" como data, senão o pagamento cairia no ciclo de agosto e a
    // fatura de julho jamais refletiria o pagamento.
    const today = new Date('2024-08-05');
    const closedPeriodEnd = new Date('2024-07-10');
    dateProvider.now.mockReturnValue(today);
    dateProvider.startOfDay.mockReturnValue(today);
    dateProvider.calculateInvoiceCycle.mockReturnValue({
      periodStart: new Date('2024-06-11'),
      periodEnd: closedPeriodEnd,
      dueDate: new Date('2024-07-15'),
    });
    accountRepository.findById
      .mockResolvedValueOnce(makeCreditCard())
      .mockResolvedValueOnce(makeCheckingAccount());
    transactionRepository.createWithBalanceUpdate.mockResolvedValue();

    const result = await service.execute(
      makeRequest({ month: 7, year: 2024 }),
    );
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.date).toEqual(closedPeriodEnd);
    }
  });

  it('should keep today as the payment date when month/year target the still-open current cycle', async () => {
    const today = new Date('2024-07-05');
    const openPeriodEnd = new Date('2024-07-10');
    dateProvider.now.mockReturnValue(today);
    dateProvider.startOfDay.mockReturnValue(today);
    dateProvider.calculateInvoiceCycle.mockReturnValue({
      periodStart: new Date('2024-06-11'),
      periodEnd: openPeriodEnd,
      dueDate: new Date('2024-07-15'),
    });
    accountRepository.findById
      .mockResolvedValueOnce(makeCreditCard())
      .mockResolvedValueOnce(makeCheckingAccount());
    transactionRepository.createWithBalanceUpdate.mockResolvedValue();

    const result = await service.execute(
      makeRequest({ month: 7, year: 2024 }),
    );
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.date).toEqual(today);
    }
  });
});
