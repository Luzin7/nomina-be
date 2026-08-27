import { AccountType, TransactionStatus } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import {
  DateProvider,
  InvoiceCycle,
} from '@providers/date/contracts/DateProvider';
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

function makeCreditCard(workspaceId = 'ws-1'): CreditCard {
  const r = CreditCard.create(
    {
      workspaceId,
      name: 'My Card',
      timezone: 'America/Sao_Paulo',
      creditLimit: 500000n,
      closingDaysBeforeDue: 5,
      dueDay: 15,
    },
    'acc-1',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

function makeCheckingAccount(): CheckingAccount {
  const r = CheckingAccount.create(
    {
      workspaceId: 'ws-1',
      name: 'Checking',
      timezone: 'UTC',
      type: AccountType.CHECKING,
      balance: 100000n,
    },
    'acc-2',
  );
  if (r.isLeft()) throw r.value;
  return r.value;
}

function makeCompletedCharge(amount: bigint): Transaction {
  const r = Transaction.create({
    workspaceId: 'ws-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    title: 'Compra no cartão',
    amount,
    date: new Date('2024-01-20'),
    type: 'EXPENSE',
    status: TransactionStatus.COMPLETED,
  });
  if (r.isLeft()) throw r.value;
  return r.value;
}

function makeCompletedPayment(amount: bigint): Transaction {
  const r = Transaction.create({
    workspaceId: 'ws-1',
    accountId: 'acc-2',
    categoryId: 'cat-1',
    destinationAccountId: 'acc-1',
    title: 'Pagamento de Fatura',
    amount,
    date: new Date('2024-01-25'),
    type: 'TRANSFER',
    status: TransactionStatus.COMPLETED,
  });
  if (r.isLeft()) throw r.value;
  return r.value;
}

describe('GetCreditCardInvoiceService', () => {
  let service: GetCreditCardInvoiceService;
  let accountRepository: jest.Mocked<AccountRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

  const invoiceCycle: InvoiceCycle = {
    periodStart: new Date('2024-01-06'),
    periodEnd: new Date('2024-02-05'),
    dueDate: new Date('2024-02-15'),
  };

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
      now: jest.fn().mockReturnValue(new Date('2024-01-15')),
      add: jest.fn(),
      format: jest.fn(),
      toTimezone: jest.fn(),
      calculateInvoiceCycle: jest.fn().mockReturnValue(invoiceCycle),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn(),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
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
    accountRepository.findById.mockResolvedValue(makeCreditCard('ws-other'));

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

  it('should return invoice data on success', async () => {
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findByAccountAndDateRange.mockResolvedValue([]);

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.account).toBeInstanceOf(CreditCard);
      expect(result.value.transactions).toEqual([]);
      expect(result.value.totalAmount).toBe(0);
      expect(result.value.dueDate).toBe(invoiceCycle.dueDate);
    }
    expect(dateProvider.calculateInvoiceCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        closingDaysBeforeDue: 5,
        dueDay: 15,
      }),
    );
  });

  it('should subtract completed payments made toward this invoice from totalAmount', async () => {
    // Bug reportado: o pagamento de uma fatura não refletia no totalAmount
    // porque o cálculo usava Math.min(chargesTotal, account.balance) — o
    // saldo GLOBAL do cartão, que também inclui cobranças de outros ciclos.
    // Pagar uma fatura antiga não reduzia o saldo abaixo do total daquele
    // ciclo específico, então nada parecia acontecer. Agora o pagamento é
    // uma transação (destinationAccountId = cartão) buscada no mesmo range
    // de datas e subtraída diretamente das cobranças daquele ciclo.
    accountRepository.findById.mockResolvedValue(makeCreditCard());
    transactionRepository.findByAccountAndDateRange.mockResolvedValue([
      makeCompletedCharge(5000n),
      makeCompletedCharge(5000n),
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
    transactionRepository.findByAccountAndDateRange.mockResolvedValue([
      makeCompletedCharge(5000n),
      makeCompletedPayment(9000n),
    ]);

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.totalAmount).toBe(0);
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
    transactionRepository.findByAccountAndDateRange.mockResolvedValue([
      charge,
      pending,
    ]);

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.availableLimit).toBe(0);
    }
  });
});
