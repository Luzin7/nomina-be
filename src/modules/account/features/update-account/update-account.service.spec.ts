import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  ConflictAccountError,
  InvalidClosingDaysBeforeDueError,
  ValidationAccountError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { UpdateAccountService } from './update-account.service';

type ServiceRequest = Parameters<
  typeof UpdateAccountService.prototype.execute
>[0];

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): ServiceRequest {
  return {
    accountId: 'acc-1',
    workspaceId: 'ws-1',
    name: 'Updated Name',
    closingDaysBeforeDue: 10,
    dueDay: 20,
    ...overrides,
  } as ServiceRequest;
}

function makeAccount(
  overrides: { workspaceId?: string; name?: string; id?: string } = {},
) {
  const result = CheckingAccount.create(
    {
      workspaceId: overrides.workspaceId ?? 'ws-1',
      name: overrides.name ?? 'Original Name',
      type: AccountType.CHECKING,
      timezone: 'America/Sao_Paulo',
    },
    overrides.id ?? 'acc-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

function makeCreditCard(workspaceId = 'ws-1', id = 'acc-1') {
  const result = CreditCard.create(
    {
      workspaceId,
      name: 'Original Name',
      timezone: 'America/Sao_Paulo',
      creditLimit: 500000n,
      closingDaysBeforeDue: 10,
      dueDay: 20,
    },
    id,
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('UpdateAccountService', () => {
  let service: UpdateAccountService;
  let accountRepository: jest.Mocked<AccountRepository>;

  beforeEach(() => {
    accountRepository = {
      findById: jest.fn(),
      findByNameAndWorkspaceId: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findAllByWorkspaceId: jest.fn(),
      countByWorkspaceId: jest.fn(),
    } as jest.Mocked<AccountRepository>;

    service = new UpdateAccountService(accountRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return left(UnauthorizedError) when account belongs to different workspace', async () => {
    accountRepository.findById.mockResolvedValue(
      makeAccount({ workspaceId: 'other-ws' }),
    );

    const result = await service.execute(makeRequest());
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('should return left(ConflictAccountError) when new name is already taken by another account', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount());
    accountRepository.findByNameAndWorkspaceId.mockResolvedValue(
      makeAccount({ id: 'acc-other' }),
    );

    const result = await service.execute(makeRequest({ name: 'Taken Name' }));
    expect(result.isLeft()).toBe(true);
    expect(result.value).toBeInstanceOf(ConflictAccountError);
  });

  it('should update successfully when name is the same account', async () => {
    const account = makeAccount();
    accountRepository.findById.mockResolvedValue(account);
    accountRepository.findByNameAndWorkspaceId.mockResolvedValue(account); // same account, not a conflict
    accountRepository.update.mockImplementation(async (a) => a);

    const result = await service.execute(makeRequest({ name: 'Updated Name' }));
    expect(result.isRight()).toBe(true);
    expect(accountRepository.update).toHaveBeenCalledTimes(1);
  });

  it('should update account when no name conflict exists', async () => {
    accountRepository.findById.mockResolvedValue(makeAccount());
    accountRepository.findByNameAndWorkspaceId.mockResolvedValue(null);
    accountRepository.update.mockImplementation(async (a) => a);

    const result = await service.execute(makeRequest());
    expect(result.isRight()).toBe(true);
    expect(accountRepository.update).toHaveBeenCalledTimes(1);
  });

  describe('credit card validation', () => {
    // O retorno de validateCreditCardFields era descartado: valores inválidos
    // eram silenciosamente ignorados e a API respondia 200 como se tivesse
    // salvo a alteração.
    it('should return left and not persist when creditLimit is invalid', async () => {
      accountRepository.findById.mockResolvedValue(makeCreditCard());
      accountRepository.findByNameAndWorkspaceId.mockResolvedValue(null);

      const result = await service.execute(
        makeRequest({ name: 'Original Name', creditLimit: 0 }),
      );

      expect(result.isLeft()).toBe(true);
      expect(result.value).toBeInstanceOf(ValidationAccountError);
      expect(accountRepository.update).not.toHaveBeenCalled();
    });

    it('should return left and not persist when closingDaysBeforeDue is invalid', async () => {
      accountRepository.findById.mockResolvedValue(makeCreditCard());
      accountRepository.findByNameAndWorkspaceId.mockResolvedValue(null);

      const result = await service.execute(
        makeRequest({
          name: 'Original Name',
          closingDaysBeforeDue: 6,
          dueDay: 20,
        }),
      );

      expect(result.isLeft()).toBe(true);
      expect(result.value).toBeInstanceOf(InvalidClosingDaysBeforeDueError);
      expect(accountRepository.update).not.toHaveBeenCalled();
    });

    it('should persist valid credit card changes', async () => {
      const card = makeCreditCard();
      accountRepository.findById.mockResolvedValue(card);
      accountRepository.findByNameAndWorkspaceId.mockResolvedValue(null);
      accountRepository.update.mockImplementation(async (a) => a);

      const result = await service.execute(
        makeRequest({
          name: 'Original Name',
          closingDaysBeforeDue: 5,
          dueDay: 15,
          creditLimit: 900000,
        }),
      );

      expect(result.isRight()).toBe(true);
      expect(card.closingDaysBeforeDue).toBe(5);
      expect(card.dueDay).toBe(15);
      expect(card.creditLimit).toBe(900000n);
      expect(accountRepository.update).toHaveBeenCalledTimes(1);
    });
  });
});
