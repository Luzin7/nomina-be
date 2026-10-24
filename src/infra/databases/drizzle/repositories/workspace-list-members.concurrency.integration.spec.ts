import { UserRole } from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { WorkspaceRepositoryImplementation } from './workspace.repository';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');

jest.setTimeout(180_000);

describe('workspace list by member against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let db: DrizzleService['db'];
  let workspaceRepository: WorkspaceRepositoryImplementation;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 5,
      onnotice: () => undefined,
    });
    const drizzleDb = drizzle(queryClient, { schema });
    await migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: drizzleDb },
        WorkspaceRepositoryImplementation,
      ],
    }).compile();

    db = moduleRef.get(DrizzleService).db;
    workspaceRepository = moduleRef.get(WorkspaceRepositoryImplementation);
  });

  afterAll(async () => {
    await moduleRef.close();
    await queryClient.end({ timeout: 5 });
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users, workspaces RESTART IDENTITY CASCADE`);
    await db.insert(schema.users).values([
      { id: 'user-x', email: 'x@example.com', passwordHash: 'h', name: 'X' },
      { id: 'user-y', email: 'y@example.com', passwordHash: 'h', name: 'Y' },
    ]);
    await db.insert(schema.workspaces).values([
      { id: 'ws-a', name: 'Alpha' },
      { id: 'ws-b', name: 'Bravo' },
      { id: 'ws-c', name: 'Charlie' },
    ]);
    await db.insert(schema.workspaceUsers).values([
      {
        workspaceId: 'ws-a',
        userId: 'user-x',
        role: UserRole.OWNER,
        isDefault: true,
      },
      { workspaceId: 'ws-b', userId: 'user-x', role: UserRole.ADMIN },
      { workspaceId: 'ws-b', userId: 'user-y', role: UserRole.OWNER },
      { workspaceId: 'ws-c', userId: 'user-y', role: UserRole.OWNER },
    ]);
  });

  it('should list owned and joined workspaces with the membership role', async () => {
    const result = await workspaceRepository.findByMemberUserId(
      'user-x',
      1,
      20,
    );

    expect(
      result.workspaces.map(({ workspace, role, isDefault }) => ({
        id: workspace.id,
        role,
        isDefault,
      })),
    ).toEqual([
      { id: 'ws-a', role: UserRole.OWNER, isDefault: true },
      { id: 'ws-b', role: UserRole.ADMIN, isDefault: false },
    ]);
    expect(result.total).toBe(2);
  });

  it('should keep total across pages', async () => {
    const result = await workspaceRepository.findByMemberUserId('user-x', 2, 1);

    expect(result.workspaces.map(({ workspace }) => workspace.id)).toEqual([
      'ws-b',
    ]);
    expect(result.total).toBe(2);
  });

  it('should keep owned count unchanged for subscription limits', async () => {
    expect(await workspaceRepository.countOwnedByUserId('user-x')).toBe(1);
  });
});
