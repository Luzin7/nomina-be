import { TransactionStatus, TransactionType } from '@constants/enums';
import { ListLastMovementsService } from '@modules/account/features/list-last-movements/list-last-movements.handler';
import {
  insertLastMovement,
  seedLastMovements,
  unwrap,
} from '@modules/account/test-helpers/last-movements-seed';
import {
  ApplicationHandle,
  createApplication,
  PostgresHandle,
  startPostgres,
} from '@shared/cache/test-helpers/freshness-harness';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';

jest.setTimeout(180_000);

type Seed = Awaited<ReturnType<typeof seedLastMovements>>;

let postgres: PostgresHandle;
let app: ApplicationHandle;

const readMovements = async (seed: Seed) => {
  const { movements } = unwrap<{
    movements: { accountId: string; transactionId: string; title: string }[];
  }>(
    await app
      .get(ListLastMovementsService)
      .execute({ workspaceId: seed.workspaceId }),
  );

  return movements;
};

describe('last movements against a real database', () => {
  beforeAll(async () => {
    postgres = await startPostgres();
    app = await createApplication(postgres.db, new InMemoryCacheProvider());
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  it('isolates each workspace and skips accounts with only pending rows', async () => {
    const first = await seedLastMovements({ app, db: postgres.db }, 'UTC');
    const second = await seedLastMovements(
      { app, db: postgres.db },
      'America/Sao_Paulo',
    );
    await insertLastMovement(postgres.db, first, {
      title: 'Antigo',
      date: new Date('2026-11-05T15:00:00.000Z'),
    });
    await insertLastMovement(postgres.db, first, {
      title: 'Mercado',
      date: new Date('2026-11-20T15:00:00.000Z'),
    });
    await insertLastMovement(postgres.db, first, {
      title: 'Transferência',
      type: TransactionType.TRANSFER,
      destinationAccountId: first.destinationAccountId,
      date: new Date('2026-11-22T15:00:00.000Z'),
    });
    await insertLastMovement(postgres.db, first, {
      accountId: first.pendingAccountId,
      title: 'Pendente',
      status: TransactionStatus.PENDING,
      date: new Date('2026-11-23T15:00:00.000Z'),
    });
    await insertLastMovement(postgres.db, second, {
      title: 'Aluguel',
      date: new Date('2026-11-18T15:00:00.000Z'),
    });
    await insertLastMovement(postgres.db, second, {
      accountId: second.pendingAccountId,
      title: 'Pendente',
      status: TransactionStatus.PENDING,
      date: new Date('2026-11-24T15:00:00.000Z'),
    });

    const firstMovements = await readMovements(first);
    const secondMovements = await readMovements(second);

    expect(firstMovements).toHaveLength(2);
    expect(firstMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: first.accountId,
          title: 'Transferência',
        }),
        expect.objectContaining({
          accountId: first.destinationAccountId,
          title: 'Transferência',
        }),
      ]),
    );
    expect(firstMovements.map(({ accountId }) => accountId)).not.toContain(
      first.pendingAccountId,
    );
    expect(secondMovements).toEqual([
      expect.objectContaining({
        accountId: second.accountId,
        title: 'Aluguel',
      }),
    ]);
    expect(secondMovements.map(({ accountId }) => accountId)).not.toContain(
      second.pendingAccountId,
    );
  });
});
