import {
  RecurrenceFrequency,
  RecurringSuggestionStatus,
} from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { instantOf, localDayIn } from '@infra/databases/drizzle/sql-helpers';
import { SYSTEM_CATEGORY_LIST } from '@modules/category/constants/system-categories';
import { RecurringSuggestion } from '@modules/transaction/entities/RecurringSuggestion';
import {
  AcceptSuggestionInput,
  AcceptSuggestionOutcome,
  BillCandidateQuery,
  BillDetectionState,
  DismissSuggestionInput,
  DismissSuggestionOutcome,
  FindSuggestionById,
  PersistDetectionInput,
  RecurringSuggestionRepository,
  RecurringSuggestionView,
} from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import {
  ActiveBillRule,
  BillDetectionTransaction,
  DAY_TOLERANCE,
  DetectedBillSuggestion,
  hasActiveMonthlyRuleForBill,
} from '@modules/transaction/valueObjects/BillSuggestionDetection';
import { isSimilarAmount } from '@modules/report/valueObjects/FixedBills';
import { Injectable, Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';
import { RecurringSuggestionMapper } from '../mappers/recurring-suggestion.mapper';
import { RecurringTransactionMapper } from '../mappers/recurring-transaction.mapper';
import * as schema from '../schema';
import { localMonthKey } from '@utils/localMonth';
import { randomUUID } from 'node:crypto';

const SYSTEM_CATEGORY_IDS = SYSTEM_CATEGORY_LIST.map((category) => category.id);

type SuggestionRow = typeof schema.recurringSuggestions.$inferSelect;
type DbTransaction = Parameters<
  Parameters<DrizzleService['db']['transaction']>[0]
>[0];

type MatchedPattern = { id: string; pattern: DetectedBillSuggestion };

type LinkRow = typeof schema.recurringSuggestionTransactions.$inferInsert;

const isSettled = (match: SuggestionRow | undefined): boolean =>
  match?.status === RecurringSuggestionStatus.DISMISSED ||
  match?.status === RecurringSuggestionStatus.ACCEPTED;

const toLinkRows = (
  suggestionId: string,
  transactionIds: string[],
): LinkRow[] =>
  transactionIds.map((transactionId) => ({ suggestionId, transactionId }));

const isSamePattern = (
  suggestion: SuggestionRow,
  pattern: DetectedBillSuggestion,
): boolean =>
  suggestion.categoryId === pattern.categoryId &&
  isSimilarAmount(suggestion.amount, pattern.amount) &&
  Math.abs(suggestion.dayOfMonth - pattern.dayOfMonth) <= DAY_TOLERANCE;

@Injectable()
export class RecurringSuggestionRepositoryImplementation implements RecurringSuggestionRepository {
  private readonly logger = new Logger(
    RecurringSuggestionRepositoryImplementation.name,
  );

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly dateProvider: DateProvider,
  ) {}

  async findDetectionState(workspaceId: string): Promise<BillDetectionState> {
    const [workspace] = await this.drizzle.db
      .select({ lastBillDetectionAt: schema.workspaces.lastBillDetectionAt })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);

    return { lastBillDetectionAt: workspace?.lastBillDetectionAt ?? null };
  }

  async findBillCandidates({
    workspaceId,
    timezone,
    from,
    to,
  }: BillCandidateQuery): Promise<BillDetectionTransaction[]> {
    const localDay = localDayIn(
      instantOf(schema.transactions.date),
      sql`${timezone}`,
    );

    return this.drizzle.db
      .select({
        id: schema.transactions.id,
        categoryId: schema.transactions.categoryId,
        categoryName: schema.categories.name,
        accountId: schema.transactions.accountId,
        amount: schema.transactions.amount,
        day: sql<number>`EXTRACT(DAY FROM ${localDay})::int`.mapWith(Number),
        month: sql<string>`to_char(${localDay}, 'YYYY-MM')`,
      })
      .from(schema.transactions)
      .innerJoin(
        schema.categories,
        eq(schema.categories.id, schema.transactions.categoryId),
      )
      .where(
        and(
          eq(schema.transactions.workspaceId, workspaceId),
          eq(schema.transactions.type, 'EXPENSE'),
          eq(schema.transactions.status, 'COMPLETED'),
          isNull(schema.transactions.installmentGroupId),
          isNull(schema.transactions.recurringId),
          notInArray(schema.transactions.categoryId, SYSTEM_CATEGORY_IDS),
          gte(schema.transactions.date, from),
          lt(schema.transactions.date, to),
        ),
      );
  }

  async findActiveExpenseRules(workspaceId: string): Promise<ActiveBillRule[]> {
    return this.loadActiveExpenseRules(this.drizzle.db, workspaceId);
  }

  private async loadActiveExpenseRules(
    db: DrizzleService['db'],
    workspaceId: string,
    categoryId?: string,
  ): Promise<ActiveBillRule[]> {
    const categoryFilter =
      categoryId === undefined
        ? []
        : [eq(schema.recurringTransactions.categoryId, categoryId)];

    const rows = await db
      .select({
        categoryId: schema.recurringTransactions.categoryId,
        amount: schema.recurringTransactions.amount,
        frequency: schema.recurringTransactions.frequency,
        interval: schema.recurringTransactions.interval,
        startDate: schema.recurringTransactions.startDate,
        endDate: schema.recurringTransactions.endDate,
      })
      .from(schema.recurringTransactions)
      .where(
        and(
          eq(schema.recurringTransactions.workspaceId, workspaceId),
          eq(schema.recurringTransactions.active, true),
          eq(schema.recurringTransactions.type, 'EXPENSE'),
          isNotNull(schema.recurringTransactions.categoryId),
          ...categoryFilter,
        ),
      );

    return rows.map((row) => ({
      categoryId: row.categoryId as string,
      amount: row.amount,
      frequency: row.frequency as RecurrenceFrequency,
      interval: row.interval,
      startDate: row.startDate,
      endDate: row.endDate,
    }));
  }

  async persistDetection({
    workspaceId,
    timezone,
    now,
    patterns,
  }: PersistDetectionInput): Promise<void> {
    const persisted = await this.drizzle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);

      const [workspace] = await tx
        .select({ lastBillDetectionAt: schema.workspaces.lastBillDetectionAt })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .for('update');

      if (!workspace) return false;
      if (
        workspace.lastBillDetectionAt &&
        localMonthKey(workspace.lastBillDetectionAt, timezone) ===
          localMonthKey(now, timezone)
      ) {
        return false;
      }

      const existing = await tx
        .select()
        .from(schema.recurringSuggestions)
        .where(eq(schema.recurringSuggestions.workspaceId, workspaceId))
        .orderBy(asc(schema.recurringSuggestions.createdAt));

      const claimed = new Set<string>();
      const toInsert: DetectedBillSuggestion[] = [];
      const toUpdate: MatchedPattern[] = [];
      const links: LinkRow[] = [];

      for (const pattern of patterns) {
        const match = existing.find(
          (row) => !claimed.has(row.id) && isSamePattern(row, pattern),
        );
        if (match) claimed.add(match.id);
        if (isSettled(match)) continue;

        if (match) {
          toUpdate.push({ id: match.id, pattern });
          links.push(...toLinkRows(match.id, pattern.transactionIds));
          continue;
        }
        toInsert.push(pattern);
      }

      await this.updatePatterns(tx, workspaceId, toUpdate, now);
      const inserted = await this.insertPatterns(tx, workspaceId, toInsert);
      for (const { id, pattern } of inserted) {
        links.push(...toLinkRows(id, pattern.transactionIds));
      }
      await this.insertLinks(tx, links);

      await tx
        .update(schema.workspaces)
        .set({ lastBillDetectionAt: now })
        .where(eq(schema.workspaces.id, workspaceId));

      return true;
    });

    if (!persisted) return;

    this.logger.log(
      `Persisted ${patterns.length} recurring suggestion patterns for workspace ${workspaceId}`,
    );
  }

  private async updatePatterns(
    tx: DbTransaction,
    workspaceId: string,
    matched: MatchedPattern[],
    now: Date,
  ): Promise<void> {
    if (matched.length === 0) return;

    const rows = sql.join(
      matched.map(
        ({ id, pattern }) =>
          sql`(${id}::text, ${pattern.accountId}::text, ${pattern.suggestedTitle}::text, ${pattern.amount}::bigint, ${pattern.dayOfMonth}::int)`,
      ),
      sql`, `,
    );

    await tx.execute(sql`
      UPDATE recurring_suggestions AS s
      SET account_id = v.account_id,
          suggested_title = v.suggested_title,
          amount = v.amount,
          day_of_month = v.day_of_month,
          updated_at = ${now.toISOString()}::timestamptz
      FROM (VALUES ${rows}) AS v(id, account_id, suggested_title, amount, day_of_month)
      WHERE s.id = v.id AND s.workspace_id = ${workspaceId}
    `);
  }

  private async insertPatterns(
    tx: DbTransaction,
    workspaceId: string,
    patterns: DetectedBillSuggestion[],
  ): Promise<{ id: string; pattern: DetectedBillSuggestion }[]> {
    if (patterns.length === 0) return [];

    const keyed = patterns.map((pattern) => ({
      id: randomUUID(),
      pattern,
    }));

    await tx.insert(schema.recurringSuggestions).values(
      keyed.map(({ id, pattern }) => ({
        id,
        workspaceId,
        categoryId: pattern.categoryId,
        accountId: pattern.accountId,
        suggestedTitle: pattern.suggestedTitle,
        amount: pattern.amount,
        dayOfMonth: pattern.dayOfMonth,
        status: RecurringSuggestionStatus.PENDING,
      })),
    );

    return keyed;
  }

  private async insertLinks(
    tx: DbTransaction,
    links: LinkRow[],
  ): Promise<void> {
    if (links.length === 0) return;

    await tx
      .insert(schema.recurringSuggestionTransactions)
      .values(links)
      .onConflictDoNothing();
  }

  async findPendingByWorkspace(
    workspaceId: string,
  ): Promise<RecurringSuggestionView[]> {
    const rows = await this.drizzle.db
      .select({
        suggestion: schema.recurringSuggestions,
        categoryName: schema.categories.name,
        accountName: schema.accounts.name,
      })
      .from(schema.recurringSuggestions)
      .innerJoin(
        schema.categories,
        eq(schema.categories.id, schema.recurringSuggestions.categoryId),
      )
      .innerJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.recurringSuggestions.accountId),
      )
      .where(
        and(
          eq(schema.recurringSuggestions.workspaceId, workspaceId),
          eq(
            schema.recurringSuggestions.status,
            RecurringSuggestionStatus.PENDING,
          ),
        ),
      )
      .orderBy(
        asc(schema.recurringSuggestions.createdAt),
        asc(schema.recurringSuggestions.id),
      );

    return rows.map((row) => ({
      suggestion: RecurringSuggestionMapper.toDomain(row.suggestion),
      categoryName: row.categoryName,
      accountName: row.accountName,
    }));
  }

  async findByIdForWorkspace({
    suggestionId,
    workspaceId,
  }: FindSuggestionById): Promise<RecurringSuggestion | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(schema.recurringSuggestions)
      .where(
        and(
          eq(schema.recurringSuggestions.id, suggestionId),
          eq(schema.recurringSuggestions.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return row ? RecurringSuggestionMapper.toDomain(row) : null;
  }

  async markShown(workspaceId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const updated = await this.drizzle.db
      .update(schema.recurringSuggestions)
      .set({ shownAt: this.dateProvider.now() })
      .where(
        and(
          eq(schema.recurringSuggestions.workspaceId, workspaceId),
          inArray(schema.recurringSuggestions.id, ids),
          eq(
            schema.recurringSuggestions.status,
            RecurringSuggestionStatus.PENDING,
          ),
          isNull(schema.recurringSuggestions.shownAt),
        ),
      )
      .returning({ id: schema.recurringSuggestions.id });

    return updated.map((row) => row.id);
  }

  async accept({
    suggestionId,
    workspaceId,
    rule,
  }: AcceptSuggestionInput): Promise<AcceptSuggestionOutcome> {
    return this.drizzle.db.transaction(async (tx) => {
      const [suggestion] = await tx
        .select()
        .from(schema.recurringSuggestions)
        .where(
          and(
            eq(schema.recurringSuggestions.id, suggestionId),
            eq(schema.recurringSuggestions.workspaceId, workspaceId),
          ),
        )
        .for('update');

      if (!suggestion) return { kind: 'not-found' };
      if (suggestion.status === RecurringSuggestionStatus.ACCEPTED) {
        return {
          kind: 'already-accepted',
          recurringId: suggestion.recurringId,
        };
      }
      if (suggestion.status === RecurringSuggestionStatus.DISMISSED) {
        return { kind: 'dismissed' };
      }

      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}), hashtext(${rule.categoryId}))`,
      );

      const activeRules = await this.loadActiveExpenseRules(
        tx,
        workspaceId,
        rule.categoryId,
      );

      if (
        hasActiveMonthlyRuleForBill(
          { categoryId: rule.categoryId, amount: Number(rule.amount) },
          activeRules,
        )
      ) {
        return { kind: 'rule-exists' };
      }

      const [created] = await tx
        .insert(schema.recurringTransactions)
        .values(RecurringTransactionMapper.toDatabase(rule))
        .returning({ id: schema.recurringTransactions.id });

      const links = await tx
        .select({
          transactionId: schema.recurringSuggestionTransactions.transactionId,
        })
        .from(schema.recurringSuggestionTransactions)
        .where(
          eq(schema.recurringSuggestionTransactions.suggestionId, suggestionId),
        );

      if (links.length > 0) {
        await tx
          .update(schema.transactions)
          .set({ recurringId: created.id })
          .where(
            inArray(
              schema.transactions.id,
              links.map((link) => link.transactionId),
            ),
          );
      }

      await tx
        .update(schema.recurringSuggestions)
        .set({
          status: RecurringSuggestionStatus.ACCEPTED,
          recurringId: created.id,
          updatedAt: this.dateProvider.now(),
        })
        .where(eq(schema.recurringSuggestions.id, suggestionId));

      return { kind: 'accepted', recurringId: created.id };
    });
  }

  async dismiss({
    suggestionId,
    workspaceId,
  }: DismissSuggestionInput): Promise<DismissSuggestionOutcome> {
    return this.drizzle.db.transaction(async (tx) => {
      const [suggestion] = await tx
        .select()
        .from(schema.recurringSuggestions)
        .where(
          and(
            eq(schema.recurringSuggestions.id, suggestionId),
            eq(schema.recurringSuggestions.workspaceId, workspaceId),
          ),
        )
        .for('update');

      if (!suggestion) return { kind: 'not-found' };
      if (suggestion.status === RecurringSuggestionStatus.ACCEPTED) {
        return { kind: 'already-accepted' };
      }

      await tx
        .update(schema.recurringSuggestions)
        .set({
          status: RecurringSuggestionStatus.DISMISSED,
          updatedAt: this.dateProvider.now(),
        })
        .where(eq(schema.recurringSuggestions.id, suggestionId));

      return { kind: 'dismissed' };
    });
  }
}
