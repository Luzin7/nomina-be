import { UserRole } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { WorkspaceInviteRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace-invite.repository';
import { WorkspaceUserRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace-user.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { InviteAlreadyUsedError } from '@modules/workspace/errors';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { AcceptWorkspaceInviteService } from './accept-workspace-invite.service';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const CODE = 'ABCD1234';

jest.setTimeout(180_000);

describe('accept workspace invite against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let db: DrizzleService['db'];
  let service: AcceptWorkspaceInviteService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();
    queryClient = postgres(container.getConnectionUri(), {
      max: 10,
      onnotice: () => undefined,
    });
    db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const drizzleService = new DrizzleService(db);
    service = new AcceptWorkspaceInviteService(
      new WorkspaceInviteRepositoryImplementation(drizzleService),
      new WorkspaceUserRepositoryImplementation(drizzleService),
    );
  });

  afterAll(async () => {
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  async function seedUser(): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.users).values({
      id,
      email: `${id}@example.com`,
      name: 'Invitee',
      passwordHash: 'hash',
    });
    return id;
  }

  it('should let only one of two concurrent accepts of the same code succeed', async () => {
    const ownerId = await seedUser();
    const workspaceId = randomUUID();
    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'WS' });
    await db.insert(schema.workspaceInvites).values({
      code: CODE,
      workspaceId,
      role: UserRole.USER,
      createdBy: ownerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const [firstUser, secondUser] = [await seedUser(), await seedUser()];

    const results = await Promise.all([
      service.execute({ code: CODE, sub: firstUser }),
      service.execute({ code: CODE, sub: secondUser }),
    ]);

    const rights = results.filter((result) => result.isRight());
    const lefts = results.filter((result) => result.isLeft());
    const members = await db
      .select()
      .from(schema.workspaceUsers)
      .where(eq(schema.workspaceUsers.workspaceId, workspaceId));
    expect(rights).toHaveLength(1);
    expect(lefts[0].value).toBeInstanceOf(InviteAlreadyUsedError);
    expect(members).toHaveLength(1);
  });
});
