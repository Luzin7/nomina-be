import { AccountType } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { UpdateAccountService } from '@modules/account/features/update-account/update-account.service';
import { AccountRepositoryImplementation } from './account.repository';

type AccountRow = typeof schema.accounts.$inferSelect;

function makeRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-1',
    workspaceId: 'ws-1',
    name: 'Old Name',
    type: AccountType.CHECKING,
    balance: 10_000,
    timezone: 'America/Sao_Paulo',
    closingDaysBeforeDue: 7,
    dueDay: null,
    creditLimit: null,
    ...overrides,
  };
}

/**
 * Stand-in de banco com semântica de UPDATE: só as colunas presentes no
 * payload de `set()` são gravadas na linha. `afterRead` simula um movimento
 * (o escritor de saldo) commitado depois da leitura da requisição.
 */
class InMemoryAccountsDatabase {
  constructor(
    public readonly rows: AccountRow[],
    private readonly afterRead?: (rows: AccountRow[]) => void,
  ) {}

  select() {
    const snapshot = this.rows.map((row) => ({ ...row }));

    return {
      from: () => ({
        where: () => ({
          limit: async () => {
            this.afterRead?.(this.rows);
            return snapshot;
          },
        }),
      }),
    };
  }

  update() {
    return {
      set: (payload: Partial<AccountRow>) => ({
        where: () => ({
          returning: async () => {
            const [target] = this.rows;
            Object.assign(target, payload);
            return [{ ...target }];
          },
        }),
      }),
    };
  }
}

function makeService(database: InMemoryAccountsDatabase): UpdateAccountService {
  const repository = new AccountRepositoryImplementation({
    db: database,
  } as unknown as DrizzleService);

  return new UpdateAccountService(repository);
}

describe('account edit preserves balance', () => {
  it('keeps the balance written by a movement completed during a name edit', async () => {
    const database = new InMemoryAccountsDatabase([makeRow()], (rows) => {
      rows[0].balance = 25_000;
    });
    const service = makeService(database);

    const result = await service.execute({
      accountId: 'acc-1',
      workspaceId: 'ws-1',
      name: 'New Name',
    });

    expect(result.isRight()).toBe(true);
    expect(database.rows[0].name).toBe('New Name');
    expect(database.rows[0].balance).toBe(25_000);
  });

  it('keeps the balance written by a charge completed during a credit card edit', async () => {
    const database = new InMemoryAccountsDatabase(
      [
        makeRow({
          type: AccountType.CREDIT_CARD,
          balance: 0,
          creditLimit: 500_000,
          closingDaysBeforeDue: 10,
          dueDay: 20,
        }),
      ],
      (rows) => {
        rows[0].balance = 30_000;
      },
    );
    const service = makeService(database);

    const result = await service.execute({
      accountId: 'acc-1',
      workspaceId: 'ws-1',
      name: 'New Name',
      creditLimit: 900_000,
      closingDaysBeforeDue: 5,
      dueDay: 15,
    });

    expect(result.isRight()).toBe(true);
    expect(database.rows[0]).toMatchObject({
      name: 'New Name',
      creditLimit: 900_000,
      closingDaysBeforeDue: 5,
      dueDay: 15,
      balance: 30_000,
    });
  });
});
