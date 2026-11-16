import {
  RecurrenceFrequency,
  RecurringSuggestionStatus,
  TransactionType,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { makeRecurring } from '@modules/transaction/test-helpers/mock-factories';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { RecurringSuggestionRepositoryImplementation } from './recurring-suggestion.repository';

type Row = Record<string, unknown>;

type Query<T> = PromiseLike<T[]> & {
  from: () => Query<T>;
  where: () => Query<T>;
  for: () => Query<T>;
  limit: () => Query<T>;
  orderBy: () => Query<T>;
  set: () => Query<T>;
  values: () => Query<T>;
  onConflictDoNothing: () => Query<T>;
  returning: () => Promise<T[]>;
};

const query = <T>(rows: T[]): Query<T> => {
  const builder = {
    from: () => builder,
    where: () => builder,
    for: () => builder,
    limit: () => builder,
    orderBy: () => builder,
    set: () => builder,
    values: () => builder,
    onConflictDoNothing: () => builder,
    returning: async () => rows,
    then: <A, B>(
      resolve: (value: T[]) => A,
      reject: (reason: unknown) => B,
    ): Promise<A | B> => Promise.resolve(rows).then(resolve, reject),
  };

  return builder as unknown as Query<T>;
};

class FakeTransaction {
  readonly calls: string[] = [];

  constructor(private readonly queued: Row[][]) {}

  select() {
    this.calls.push('select');

    return query(this.queued.shift() ?? []);
  }

  execute() {
    this.calls.push('lock');

    return Promise.resolve([]);
  }

  insert() {
    this.calls.push('insert');

    return query([{ id: 'rec-new' }]);
  }

  update() {
    this.calls.push('update');

    return query([]);
  }
}

const makeRepository = (queued: Row[][]) => {
  const transaction = new FakeTransaction(queued);
  const drizzle = {
    db: {
      transaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work(transaction),
    },
  };

  return {
    repository: new RecurringSuggestionRepositoryImplementation(
      drizzle as unknown as DrizzleService,
      new DayJsDateProvider(),
    ),
    transaction,
  };
};

const pendingSuggestion = (overrides: Row = {}): Row => ({
  id: 'suggestion-1',
  workspaceId: 'ws-1',
  status: RecurringSuggestionStatus.PENDING,
  recurringId: null,
  ...overrides,
});

const activeRule = (overrides: Row = {}): Row => ({
  categoryId: 'cat-1',
  amount: 150_000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDate: new Date('2026-11-05T03:00:00.000Z'),
  endDate: null,
  ...overrides,
});

const acceptInput = () => ({
  suggestionId: 'suggestion-1',
  workspaceId: 'ws-1',
  rule: makeRecurring({
    categoryId: 'cat-1',
    amount: 150_000n,
    frequency: RecurrenceFrequency.MONTHLY,
    type: TransactionType.EXPENSE,
    startDate: new Date('2026-12-05T03:00:00.000Z'),
  }),
});

describe('RecurringSuggestionRepositoryImplementation accept', () => {
  it('locks the bill before inserting the rule', async () => {
    const { repository, transaction } = makeRepository([
      [pendingSuggestion()],
      [],
      [],
    ]);

    const outcome = await repository.accept(acceptInput());

    expect(outcome).toEqual({ kind: 'accepted', recurringId: 'rec-new' });
    expect(transaction.calls).toEqual([
      'select',
      'lock',
      'select',
      'insert',
      'select',
      'update',
    ]);
  });

  it('returns rule-exists and writes nothing when the bill has an active rule', async () => {
    const { repository, transaction } = makeRepository([
      [pendingSuggestion()],
      [activeRule()],
    ]);

    const outcome = await repository.accept(acceptInput());

    expect(outcome).toEqual({ kind: 'rule-exists' });
    expect(transaction.calls).toEqual(['select', 'lock', 'select']);
  });

  it('treats a similar amount as the same bill', async () => {
    const { repository } = makeRepository([
      [pendingSuggestion()],
      [activeRule({ amount: 27863 })],
    ]);

    const outcome = await repository.accept({
      ...acceptInput(),
      rule: makeRecurring({ categoryId: 'cat-1', amount: 23000n }),
    });

    expect(outcome).toEqual({ kind: 'rule-exists' });
  });

  it('keeps the replay contract without taking the bill lock', async () => {
    const { repository, transaction } = makeRepository([
      [
        pendingSuggestion({
          status: RecurringSuggestionStatus.ACCEPTED,
          recurringId: 'rec-1',
        }),
      ],
    ]);

    const outcome = await repository.accept(acceptInput());

    expect(outcome).toEqual({ kind: 'already-accepted', recurringId: 'rec-1' });
    expect(transaction.calls).toEqual(['select']);
  });
});
