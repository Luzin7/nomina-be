import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { ListTransactionsService } from './list-transaction.service';

type ServiceRequest = Parameters<
  typeof ListTransactionsService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    sub: 'user-1',
    workspaceId: 'ws-1',
    page: 1,
    pageSize: 20,
    ...overrides,
  } as ServiceRequest;
}

describe('ListTransactionsService', () => {
  let service: ListTransactionsService;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let dateProvider: jest.Mocked<DateProvider>;

  beforeEach(() => {
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
      now: jest.fn(),
      add: jest.fn(),
      format: jest.fn(),
      toTimezone: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn().mockReturnValue(new Date('2024-01-01')),
      endOfDay: jest.fn().mockReturnValue(new Date('2024-01-31')),
      startOfMonth: jest.fn(),
    } as unknown as jest.Mocked<DateProvider>;

    service = new ListTransactionsService(transactionRepository, dateProvider);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return transactions and total from repository', async () => {
    transactionRepository.listTransactionsByWorkspaceId.mockResolvedValue({
      transactions: [],
      total: 0,
    });

    const result = await service.execute(makeRequest());

    expect(result.isRight()).toBe(true);
    if (result.isRight()) {
      expect(result.value.transactions).toEqual([]);
      expect(result.value.total).toBe(0);
    }
    expect(
      transactionRepository.listTransactionsByWorkspaceId,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', page: 1, pageSize: 20 }),
    );
  });

  it('should apply date range when startDate and endDate are provided', async () => {
    transactionRepository.listTransactionsByWorkspaceId.mockResolvedValue({
      transactions: [],
      total: 0,
    });

    await service.execute(
      makeRequest({ startDate: '2024-01-01', endDate: '2024-01-31' }),
    );

    expect(dateProvider.startOfDay).toHaveBeenCalledWith(
      '2024-01-01',
      expect.any(String),
    );
    expect(dateProvider.endOfDay).toHaveBeenCalledWith(
      '2024-01-31',
      expect.any(String),
    );
  });
});
