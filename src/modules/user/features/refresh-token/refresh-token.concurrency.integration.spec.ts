import { RefreshTokenStatus, UserRole } from '@constants/enums';
import { DRIZZLE_TOKEN } from '@infra/databases/drizzle/drizzle.provider';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AuthSessionRepositoryImplementation } from '@infra/databases/drizzle/repositories/auth-session.repository';
import { RefreshTokenRepositoryImplementation } from '@infra/databases/drizzle/repositories/refresh-token.repository';
import { UserRepositoryImplementation } from '@infra/databases/drizzle/repositories/user.repository';
import { WorkspaceUserRepositoryImplementation } from '@infra/databases/drizzle/repositories/workspace-user.repository';
import * as schema from '@infra/databases/drizzle/schema';
import { User } from '@modules/user/entities/User';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { AuthTokenPairFactory } from '@modules/user/services/auth-token-pair.factory';
import { IssueAuthSessionService } from '@modules/user/services/issue-auth-session.service';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { JwtEncrypter } from '@providers/cryptography/implementations/jwtEncrypter';
import { RefreshTokenGenerator } from '@providers/cryptography/contracts/RefreshTokenGenerator';
import { HmacRefreshTokenGenerator } from '@providers/cryptography/implementations/HmacRefreshTokenGenerator';
import { Sha256TokenHasher } from '@providers/cryptography/implementations/Sha256TokenHasher';
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
import { LogoutUserService } from '../logout-user/logout-user.service';
import { RefreshTokenService } from './refresh-token.service';

const MIGRATIONS_FOLDER = resolve(__dirname, '../../../../../drizzle');
const JWT_SECRET = 'refresh-concurrency-secret';
const PAST_GRACE_WINDOW_IN_SECONDS = 61;
const WORKSPACE_NAME = 'Espaço Pessoal';
const DEFAULT_WORKSPACE_ID = 'claim-only-workspace';
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class SettableClockDateProvider extends DayJsDateProvider {
  private offsetInSeconds = 0;

  advanceSeconds(seconds: number): void {
    this.offsetInSeconds += seconds;
  }

  reset(): void {
    this.offsetInSeconds = 0;
  }

  override now(): Date {
    return new Date(super.now().getTime() + this.offsetInSeconds * 1_000);
  }

  override addDaysInCurrentDate(days: number): Date {
    return new Date(
      super.addDaysInCurrentDate(days).getTime() + this.offsetInSeconds * 1_000,
    );
  }
}

jest.setTimeout(180_000);

describe('refresh token rotation against a real postgres', () => {
  let container: StartedPostgreSqlContainer;
  let queryClient: postgres.Sql;
  let moduleRef: TestingModule;
  let drizzleService: DrizzleService;
  let clock: SettableClockDateProvider;
  let userRepository: UserRepository;
  let authSessionsRepository: AuthSessionsRepository;
  let issueAuthSessionService: IssueAuthSessionService;
  let refreshTokenService: RefreshTokenService;
  let logoutUserService: LogoutUserService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withStartupTimeout(120_000)
      .start();

    queryClient = postgres(container.getConnectionUri(), {
      max: 20,
      onnotice: () => undefined,
    });
    const db = drizzle(queryClient, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: JWT_SECRET,
          signOptions: { algorithm: 'HS256' },
        }),
      ],
      providers: [
        DrizzleService,
        { provide: DRIZZLE_TOKEN, useValue: db },
        { provide: UserRepository, useClass: UserRepositoryImplementation },
        {
          provide: WorkspaceUserRepository,
          useClass: WorkspaceUserRepositoryImplementation,
        },
        {
          provide: AuthSessionsRepository,
          useClass: AuthSessionRepositoryImplementation,
        },
        {
          provide: RefreshTokensRepository,
          useClass: RefreshTokenRepositoryImplementation,
        },
        { provide: Encrypter, useClass: JwtEncrypter },
        { provide: TokenHasher, useClass: Sha256TokenHasher },
        {
          provide: RefreshTokenGenerator,
          useValue: new HmacRefreshTokenGenerator(JWT_SECRET),
        },
        { provide: DateProvider, useClass: SettableClockDateProvider },
        AuthTokenPairFactory,
        IssueAuthSessionService,
        RefreshTokenService,
        LogoutUserService,
      ],
    }).compile();

    drizzleService = moduleRef.get(DrizzleService);
    clock = moduleRef.get(DateProvider);
    userRepository = moduleRef.get(UserRepository);
    authSessionsRepository = moduleRef.get(AuthSessionsRepository);
    issueAuthSessionService = moduleRef.get(IssueAuthSessionService);
    refreshTokenService = moduleRef.get(RefreshTokenService);
    logoutUserService = moduleRef.get(LogoutUserService);
  });

  beforeEach(() => {
    clock.reset();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await queryClient?.end({ timeout: 5 });
    await container?.stop();
  });

  async function seedUser(): Promise<User> {
    const user = User.create(
      {
        name: 'Refresh User',
        email: `${randomUUID()}@example.com`,
        passwordHash: 'hash',
      },
      randomUUID(),
    );
    if (user.isLeft()) throw user.value;
    await userRepository.create(user.value);

    return user.value;
  }

  function issueSessionFor(user: User) {
    return issueAuthSessionService.execute({
      userId: user.id,
      userName: user.name,
      workspaceId: DEFAULT_WORKSPACE_ID,
      workspaceName: WORKSPACE_NAME,
      role: UserRole.OWNER,
    });
  }

  async function seedIssuedRefreshToken(): Promise<string> {
    const user = await seedUser();
    const issued = await issueSessionFor(user);
    if (issued.isLeft()) throw issued.value;

    return issued.value.refreshToken;
  }

  async function refreshOutcome(refreshToken: string): Promise<string> {
    try {
      const result = await refreshTokenService.execute(refreshToken);
      if (result.isLeft()) return result.value.constructor.name;

      return result.value.refreshToken;
    } catch (error) {
      return (error as Error).message;
    }
  }

  function refreshConcurrently(
    refreshToken: string,
    times: number,
  ): Promise<string[]> {
    return Promise.all(
      Array.from({ length: times }, () => refreshOutcome(refreshToken)),
    );
  }

  async function sessionIdOf(refreshToken: string): Promise<string> {
    const tokenHash = moduleRef.get(TokenHasher).hash(refreshToken);
    const [stored] = await drizzleService.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash));

    return stored.sessionId;
  }

  async function activeTokenCountOf(sessionId: string): Promise<number> {
    const active = await drizzleService.db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.sessionId, sessionId),
          eq(schema.refreshTokens.status, RefreshTokenStatus.ACTIVE),
        ),
      );

    return active.length;
  }

  async function isSessionRevoked(sessionId: string): Promise<boolean> {
    const session = await authSessionsRepository.findUniqueById(sessionId);

    return session?.isRevoked() ?? false;
  }

  it('should return the same refresh token to two concurrent refreshes', async () => {
    const refreshToken = await seedIssuedRefreshToken();

    const outcomes = await refreshConcurrently(refreshToken, 2);

    expect(outcomes[0]).toMatch(REFRESH_TOKEN_PATTERN);
    expect(outcomes[1]).toBe(outcomes[0]);
  });

  it('should return the same refresh token to three concurrent refreshes', async () => {
    const refreshToken = await seedIssuedRefreshToken();

    const outcomes = await refreshConcurrently(refreshToken, 3);

    expect(outcomes[0]).toMatch(REFRESH_TOKEN_PATTERN);
    expect(new Set(outcomes).size).toBe(1);
  });

  it('should keep one active token and a live session after ten concurrent refreshes', async () => {
    const refreshToken = await seedIssuedRefreshToken();
    const sessionId = await sessionIdOf(refreshToken);

    await refreshConcurrently(refreshToken, 10);

    expect(await isSessionRevoked(sessionId)).toBe(false);
    expect(await activeTokenCountOf(sessionId)).toBe(1);
  });

  it('should issue two sessions for the same user in the same second', async () => {
    const user = await seedUser();

    const issued = await Promise.all([
      issueSessionFor(user),
      issueSessionFor(user),
    ]);

    expect(issued.map((result) => result.isRight())).toEqual([true, true]);
  });

  it('should revoke the session when a token is reused after the grace window', async () => {
    const refreshToken = await seedIssuedRefreshToken();
    const sessionId = await sessionIdOf(refreshToken);
    await refreshOutcome(refreshToken);
    clock.advanceSeconds(PAST_GRACE_WINDOW_IN_SECONDS);

    const reused = await refreshOutcome(refreshToken);

    expect(reused).toBe('SessionExpiredError');
    expect(await isSessionRevoked(sessionId)).toBe(true);
  });

  it('should keep a revoked session revoked when renewed', async () => {
    const refreshToken = await seedIssuedRefreshToken();
    const sessionId = await sessionIdOf(refreshToken);
    const session = await authSessionsRepository.findUniqueById(sessionId);
    await authSessionsRepository.revoke(sessionId);

    await authSessionsRepository.renew(session!);

    expect(await isSessionRevoked(sessionId)).toBe(true);
  });

  it('should stamp rotated_at on the rotated token', async () => {
    const refreshToken = await seedIssuedRefreshToken();
    await refreshOutcome(refreshToken);

    const [rotated] = await drizzleService.db
      .select()
      .from(schema.refreshTokens)
      .where(
        eq(
          schema.refreshTokens.tokenHash,
          moduleRef.get(TokenHasher).hash(refreshToken),
        ),
      );

    expect(rotated.rotatedAt).toBeInstanceOf(Date);
  });

  it('should reject a token reused inside the grace window after logout', async () => {
    const refreshToken = await seedIssuedRefreshToken();
    const rotated = await refreshOutcome(refreshToken);
    await logoutUserService.execute(rotated);

    const reused = await refreshOutcome(refreshToken);

    expect(reused).toBe('SessionExpiredError');
  });
});
