import {
  BalanceMovementCause,
  TransactionStatus,
  TransactionType,
} from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RedisService } from '@infra/cache/redis/RedisService';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AccountRepositoryImplementation } from '@infra/databases/drizzle/repositories/account.repository';
import { CategoryRepositoryImplementation } from '@infra/databases/drizzle/repositories/category.repository';
import { TransactionRepositoryImplementation } from '@infra/databases/drizzle/repositories/transaction.repository';
import { WorkspaceRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { makeCheckingAccount } from '@modules/account/test-helpers/mock-factories';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { DeleteTransactionService } from '../delete-transaction/delete-transaction.service';
import { ToggleTransactionStatusService } from '../toggle-transaction-status/toggle-transaction-status.service';
import { CreateTransactionService } from './create-transaction.service';

type CreateRequest = Parameters<
  typeof CreateTransactionService.prototype.execute
>[0];
type DeleteRequest = Parameters<
  typeof DeleteTransactionService.prototype.execute
>[0];
type ToggleRequest = Parameters<
  typeof ToggleTransactionStatusService.prototype.execute
>[0];

const OPENING_BALANCE = 50_000n;
const AMOUNT = 1_000n;
const WORKSPACE_TIMEZONE = 'UTC';
const TRANSACTION_DATE = '2024-01-20';
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('balance movements written with the balance update', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let drizzleService: DrizzleService;
  let workspaceRepository: WorkspaceRepository;
  let accountRepository: AccountRepository;
  let categoryRepository: CategoryRepository;
  let createTransactionService: CreateTransactionService;
  let deleteTransactionService: DeleteTransactionService;
  let toggleTransactionStatusService: ToggleTransactionStatusService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 10,
      onnotice: () => undefined,
    });
    const db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: db },
        {
          provide: WorkspaceRepository,
          useClass: WorkspaceRepositoryImplementation,
        },
        {
          provide: AccountRepository,
          useClass: AccountRepositoryImplementation,
        },
        {
          provide: CategoryRepository,
          useClass: CategoryRepositoryImplementation,
        },
        {
          provide: TransactionRepository,
          useClass: TransactionRepositoryImplementation,
        },
        { provide: CacheProvider, useClass: RedisService },
        { provide: ConfigService, useValue: {} },
        { provide: DateProvider, useClass: DayJsDateProvider },
        CreateTransactionService,
        DeleteTransactionService,
        ToggleTransactionStatusService,
      ],
    }).compile();

    drizzleService = moduleRef.get(DrizzleService);
    workspaceRepository = moduleRef.get(WorkspaceRepository);
    accountRepository = moduleRef.get(AccountRepository);
    categoryRepository = moduleRef.get(CategoryRepository);
    createTransactionService = moduleRef.get(CreateTransactionService);
    deleteTransactionService = moduleRef.get(DeleteTransactionService);
    toggleTransactionStatusService = moduleRef.get(
      ToggleTransactionStatusService,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  async function seedWorkspace(): Promise<{
    workspaceId: string;
    accountId: string;
    destinationAccountId: string;
    categoryId: string;
  }> {
    const workspaceId = randomUUID();
    const accountId = randomUUID();
    const destinationAccountId = randomUUID();
    const categoryId = randomUUID();

    const workspace = Workspace.create(
      { name: 'Balance movements', timezone: WORKSPACE_TIMEZONE },
      workspaceId,
    );
    if (workspace.isLeft()) throw workspace.value;
    await workspaceRepository.create(workspace.value);

    for (const id of [accountId, destinationAccountId]) {
      const account = makeCheckingAccount({
        id,
        workspaceId,
        balance: OPENING_BALANCE,
        timezone: WORKSPACE_TIMEZONE,
      });
      await accountRepository.create(account);
    }

    const category = Category.create(
      {
        workspaceId,
        name: 'Groceries',
        type: TransactionType.EXPENSE,
        parentId: null,
        isSystemCategory: false,
      },
      categoryId,
    );
    if (category.isLeft()) throw category.value;
    await categoryRepository.create(category.value);

    return { workspaceId, accountId, destinationAccountId, categoryId };
  }

  async function findTransactionIdByTitle(
    workspaceId: string,
    title: string,
  ): Promise<string> {
    const [row] = await drizzleService.db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          eq(schema.transactions.title, title),
        ),
      )
      .limit(1);
    if (!row) throw new Error('created transaction not found');

    return row.id;
  }

  async function createExpense(
    workspaceId: string,
    accountId: string,
    categoryId: string,
    amount: bigint,
  ): Promise<string> {
    const title = `Ledger expense ${randomUUID()}`;
    const result = await createTransactionService.execute({
      workspaceId,
      sub: randomUUID(),
      accountId,
      categoryId,
      title,
      amount,
      date: TRANSACTION_DATE,
      type: TransactionType.EXPENSE,
      status: TransactionStatus.COMPLETED,
    } as CreateRequest);
    if (result.isLeft()) throw result.value;

    return findTransactionIdByTitle(workspaceId, title);
  }

  async function createTransfer(
    workspaceId: string,
    accountId: string,
    destinationAccountId: string,
    categoryId: string,
    amount: bigint,
  ): Promise<string> {
    const title = `Ledger transfer ${randomUUID()}`;
    const result = await createTransactionService.execute({
      workspaceId,
      sub: randomUUID(),
      accountId,
      destinationAccountId,
      categoryId,
      title,
      amount,
      date: TRANSACTION_DATE,
      type: TransactionType.TRANSFER,
      status: TransactionStatus.COMPLETED,
    } as CreateRequest);
    if (result.isLeft()) throw result.value;

    return findTransactionIdByTitle(workspaceId, title);
  }

  async function movementsOfTransaction(transactionId: string) {
    return drizzleService.db
      .select()
      .from(schema.balanceMovements)
      .where(eq(schema.balanceMovements.transactionId, transactionId))
      .orderBy(schema.balanceMovements.seq);
  }

  async function movementsOfAccount(accountId: string) {
    return drizzleService.db
      .select()
      .from(schema.balanceMovements)
      .where(eq(schema.balanceMovements.accountId, accountId))
      .orderBy(schema.balanceMovements.seq);
  }

  async function balanceOf(accountId: string): Promise<number> {
    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error('seeded account not found');

    return Number(account.balance);
  }

  it('records a TRANSACTION_CREATED movement for a completed expense', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transactionId = await createExpense(
      workspaceId,
      accountId,
      categoryId,
      AMOUNT,
    );

    const movements = await movementsOfTransaction(transactionId);
    const balance = await balanceOf(accountId);

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      workspaceId,
      accountId,
      transactionId,
      cause: BalanceMovementCause.TRANSACTION_CREATED,
    });
    expect(movements[0].delta).toBe(-Number(AMOUNT));
    expect(movements[0].balanceAfter).toBe(balance);
  });

  it('records a TRANSACTION_DELETED movement that restores the balance', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transactionId = await createExpense(
      workspaceId,
      accountId,
      categoryId,
      AMOUNT,
    );

    const deleted = await deleteTransactionService.execute({
      transactionId,
      workspaceId,
      sub: randomUUID(),
    } as DeleteRequest);
    if (deleted.isLeft()) throw deleted.value;

    const movements = await movementsOfTransaction(transactionId);
    const deletion = movements.filter(
      (movement) => movement.cause === BalanceMovementCause.TRANSACTION_DELETED,
    );

    expect(deletion).toHaveLength(1);
    expect(deletion[0].delta).toBe(Number(AMOUNT));
    expect(deletion[0].balanceAfter).toBe(Number(OPENING_BALANCE));
    expect(await balanceOf(accountId)).toBe(Number(OPENING_BALANCE));
  });

  it('records two STATUS_CHANGED movements that cancel each other', async () => {
    const { workspaceId, accountId, categoryId } = await seedWorkspace();
    const transactionId = await createExpense(
      workspaceId,
      accountId,
      categoryId,
      AMOUNT,
    );

    for (let index = 0; index < 2; index += 1) {
      const toggled = await toggleTransactionStatusService.execute({
        transactionId,
        workspaceId,
      } as ToggleRequest);
      if (toggled.isLeft()) throw toggled.value;
    }

    const movements = await movementsOfTransaction(transactionId);
    const statusChanges = movements.filter(
      (movement) => movement.cause === BalanceMovementCause.STATUS_CHANGED,
    );
    const balance = await balanceOf(accountId);

    expect(statusChanges).toHaveLength(2);
    expect(
      statusChanges.reduce((total, movement) => total + movement.delta, 0),
    ).toBe(0);
    expect(statusChanges.at(-1)?.balanceAfter).toBe(balance);
  });

  it('keeps every movement consistent with the account balance', async () => {
    const { workspaceId, accountId, destinationAccountId, categoryId } =
      await seedWorkspace();

    await createExpense(workspaceId, accountId, categoryId, AMOUNT);
    const deletedTransactionId = await createExpense(
      workspaceId,
      accountId,
      categoryId,
      400n,
    );

    await createTransfer(
      workspaceId,
      accountId,
      destinationAccountId,
      categoryId,
      250n,
    );

    const deleted = await deleteTransactionService.execute({
      transactionId: deletedTransactionId,
      workspaceId,
      sub: randomUUID(),
    } as DeleteRequest);
    if (deleted.isLeft()) throw deleted.value;

    const movements = await movementsOfAccount(accountId);
    const balance = await balanceOf(accountId);
    const first = movements[0];
    const balanceBeforeFirstMovement = first.balanceAfter - first.delta;
    const deltaSum = movements.reduce(
      (total, movement) => total + movement.delta,
      0,
    );

    expect(movements.at(-1)?.balanceAfter).toBe(balance);
    expect(deltaSum).toBe(balance - balanceBeforeFirstMovement);
  });

  it('records one movement per account for a transfer', async () => {
    const { workspaceId, accountId, destinationAccountId, categoryId } =
      await seedWorkspace();

    const transferId = await createTransfer(
      workspaceId,
      accountId,
      destinationAccountId,
      categoryId,
      700n,
    );

    const movements = await movementsOfTransaction(transferId);
    const byAccount = new Map(
      movements.map((movement) => [movement.accountId, movement]),
    );

    expect(movements).toHaveLength(2);
    expect(movements.map((movement) => movement.transactionId)).toEqual([
      transferId,
      transferId,
    ]);
    expect(movements.map((movement) => movement.cause)).toEqual([
      BalanceMovementCause.TRANSACTION_CREATED,
      BalanceMovementCause.TRANSACTION_CREATED,
    ]);
    expect(byAccount.get(accountId)?.delta).toBe(-700);
    expect(byAccount.get(destinationAccountId)?.delta).toBe(700);
    expect(byAccount.get(accountId)?.balanceAfter).toBe(
      Number(OPENING_BALANCE) - 700,
    );
    expect(byAccount.get(destinationAccountId)?.balanceAfter).toBe(
      Number(OPENING_BALANCE) + 700,
    );
  });
});
