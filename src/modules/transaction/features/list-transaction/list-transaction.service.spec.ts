import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
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

function makeTimezoneService(
  timezone: string,
): jest.Mocked<GetWorkspaceTimezoneService> {
  return {
    execute: jest.fn().mockResolvedValue(timezone),
  } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
}

describe('ListTransactionsService', () => {
  let service: ListTransactionsService;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let dateProvider: jest.Mocked<DateProvider>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;

  beforeEach(() => {
    transactionRepository = {
      create: jest.fn(),
      findUniqueById: jest.fn(),
      listTransactionsByWorkspaceId: jest.fn(),
      getTopExpensesByCategory: jest.fn(),
      createWithBalanceUpdate: jest.fn(),
      createInstallmentPlan: jest.fn(),
      updateWithBalanceEffect: jest.fn(),
      deleteWithBalanceEffect: jest.fn(),
      updateStatusWithBalanceEffect: jest.fn(),
      findCreditCardLedger: jest.fn(),
      findDueCardTransactions: jest.fn(),
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

    transactionRepository.listTransactionsByWorkspaceId.mockResolvedValue({
      transactions: [],
      total: 0,
    });

    workspaceTimezone = makeTimezoneService('America/Sao_Paulo');

    service = new ListTransactionsService(
      transactionRepository,
      dateProvider,
      workspaceTimezone,
    );
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

  it('should resolve the day range in the workspace timezone', async () => {
    await service.execute(
      makeRequest({ startDate: '2024-01-01', endDate: '2024-01-31' }),
    );

    expect(workspaceTimezone.execute).toHaveBeenCalledWith('ws-1');
    expect(dateProvider.startOfDay).toHaveBeenCalledWith(
      '2024-01-01',
      'America/Sao_Paulo',
    );
    expect(dateProvider.endOfDay).toHaveBeenCalledWith(
      '2024-01-31',
      'America/Sao_Paulo',
    );
  });

  describe.each([
    ['UTC', '2026-11-15T23:30:00.000Z', '2026-11-16T00:30:00.000Z'],
    [
      'America/Sao_Paulo',
      '2026-11-16T02:30:00.000Z',
      '2026-11-16T03:30:00.000Z',
    ],
  ])('workspace in %s', (timezone, insideEndDate, outsideEndDate) => {
    it('should include 23:30 local on the 15th and exclude the 16th when endDate is the 15th', async () => {
      const realDateProvider = new DayJsDateProvider();
      const zonedService = new ListTransactionsService(
        transactionRepository,
        realDateProvider,
        makeTimezoneService(timezone),
      );

      await zonedService.execute(makeRequest({ endDate: '2026-11-15' }));

      const { endDate } =
        transactionRepository.listTransactionsByWorkspaceId.mock.calls[0][0];
      expect(new Date(insideEndDate).getTime()).toBeLessThanOrEqual(
        endDate!.getTime(),
      );
      expect(new Date(outsideEndDate).getTime()).toBeGreaterThan(
        endDate!.getTime(),
      );
    });
  });
});
