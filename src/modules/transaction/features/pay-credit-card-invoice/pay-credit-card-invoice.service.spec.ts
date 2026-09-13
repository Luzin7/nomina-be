import { TransactionStatus } from '@constants/enums';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  InvalidAccountError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  makeCheckingAccount,
  makeCreditCard,
} from '@modules/account/test-helpers/mock-factories';
import { SYSTEM_CATEGORY } from '@modules/category/constants/system-categories';
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
    accountRepository.findById.mockResolvedValue(
      makeCheckingAccount({ id: 'acc-src' }),
    );

    const result = await service.execute(
      makeRequest({ creditCardAccountId: 'acc-cc' }),
    );
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(InvalidAccountError);
  });

  it('should return left(SourceAndDestinationAccountMustBeDifferentError) when source equals destination', async () => {
    accountRepository.findById.mockResolvedValue(
      makeCreditCard({ id: 'acc-cc', timezone: 'UTC', balance: 100000n }),
    );

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
      .mockResolvedValueOnce(
        makeCreditCard({ id: 'acc-cc', timezone: 'UTC', balance: 100000n }),
      )
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
      .mockResolvedValueOnce(
        makeCreditCard({ id: 'acc-cc', timezone: 'UTC', balance: 100000n }),
      )
      .mockResolvedValueOnce(cc2.value);

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(CannotPayInvoiceWithCreditCardError);
  });

  it('should create a TRANSFER transaction and persist on success', async () => {
    accountRepository.findById
      .mockResolvedValueOnce(
        makeCreditCard({ id: 'acc-cc', timezone: 'UTC', balance: 100000n }),
      )
      .mockResolvedValueOnce(makeCheckingAccount({ id: 'acc-src' }));
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
      .mockResolvedValueOnce(
        makeCreditCard({ id: 'acc-cc', timezone: 'UTC', balance: 100000n }),
      )
      .mockResolvedValueOnce(makeCheckingAccount({ id: 'acc-src' }));
    transactionRepository.createWithBalanceUpdate.mockResolvedValue();

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.date).toEqual(today);
      expect(result.value.invoicePeriodMonth).toBeNull();
      expect(result.value.invoicePeriodYear).toBeNull();
    }
  });

  it('should set invoicePeriod when month/year are provided and use today as the transaction date', async () => {
    const today = new Date('2024-08-05');
    dateProvider.now.mockReturnValue(today);
    dateProvider.startOfDay.mockReturnValue(today);
    accountRepository.findById
      .mockResolvedValueOnce(
        makeCreditCard({ id: 'acc-cc', timezone: 'UTC', balance: 100000n }),
      )
      .mockResolvedValueOnce(makeCheckingAccount({ id: 'acc-src' }));
    transactionRepository.createWithBalanceUpdate.mockResolvedValue();

    const result = await service.execute(makeRequest({ month: 7, year: 2024 }));
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.date).toEqual(today);
      expect(result.value.invoicePeriodMonth).toBe(7);
      expect(result.value.invoicePeriodYear).toBe(2024);
    }
  });

  describe('categoria do pagamento', () => {
    // O DTO trazia esse mesmo UUID como `default`, mas ele era só o ID que o
    // seed tinha gerado no banco de um dev — em qualquer outro ambiente o
    // insert violaria a FK. Agora o ID é contrato: a migration 0013 garante a
    // linha com exatamente esse ID, então usar a constante é seguro e evita uma
    // consulta ao banco em todo pagamento.
    it('should use the credit card system category when none is provided', async () => {
      accountRepository.findById
        .mockResolvedValueOnce(
          makeCreditCard({ id: 'acc-cc', timezone: 'UTC', balance: 100000n }),
        )
        .mockResolvedValueOnce(makeCheckingAccount({ id: 'acc-src' }));
      transactionRepository.createWithBalanceUpdate.mockResolvedValue();

      const result = await service.execute(makeRequest());

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categoryId).toBe(
          SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
        );
      }
    });

    it('should keep an explicit categoryId when the client provides one', async () => {
      accountRepository.findById
        .mockResolvedValueOnce(
          makeCreditCard({ id: 'acc-cc', timezone: 'UTC', balance: 100000n }),
        )
        .mockResolvedValueOnce(makeCheckingAccount({ id: 'acc-src' }));
      transactionRepository.createWithBalanceUpdate.mockResolvedValue();

      const result = await service.execute(
        makeRequest({ categoryId: 'chosen-category' }),
      );

      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.categoryId).toBe('chosen-category');
      }
    });
  });
});
