import { BalanceMovementCause } from '@constants/enums';
import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const OPENING_CAUSE_LITERAL = `'${BalanceMovementCause.OPENING}'`;

// --------------------------------------------------------
// INFRAESTRUTURA & AUTH
// --------------------------------------------------------

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$default(() => crypto.randomUUID()),
  email: text('email').notNull().unique('users_email_key'),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', {
    withTimezone: true,
    mode: 'date',
  }).$onUpdate(() => new Date()),
});

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp('last_used_at', {
      withTimezone: true,
      mode: 'date',
    })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    revokedAt: timestamp('revoked_at', {
      withTimezone: true,
      mode: 'date',
    }),
  },
  (table) => [index('idx_auth_sessions_user_id').on(table.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    tokenHash: text('token_hash').notNull().unique(),
    sessionId: text('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .defaultNow()
      .notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('idx_refresh_tokens_session_id').on(table.sessionId)],
);

// --------------------------------------------------------
// WORKSPACE & COLABORAÇÃO
// --------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id')
    .primaryKey()
    .$default(() => crypto.randomUUID()),
  name: text('name').notNull(),
  currency: text('currency').default('BRL').notNull(),
  timezone: text('time_zone').default(DEFAULT_TIMEZONE).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  lastBillDetectionAt: timestamp('last_bill_detection_at', {
    withTimezone: true,
    mode: 'date',
  }),
});

export const workspaceUsers = pgTable(
  'workspace_users',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    timezone: text('time_zone').notNull().default(DEFAULT_TIMEZONE),
    isDefault: boolean('is_default').default(false).notNull(),
    role: text('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('workspace_users_workspace_id_user_id_key').on(
      table.workspaceId,
      table.userId,
    ),
    index('idx_wu_user_default').on(table.userId, table.isDefault),
  ],
);

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    code: text('code').notNull().unique('workspace_invites_code_key'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    usedBy: text('used_by'),
  },
  (table) => [
    index('workspace_invites_code_idx').on(table.code),
    index('workspace_invites_workspace_id_expires_at_idx').on(
      table.workspaceId,
      table.expiresAt,
    ),
  ],
);

// --------------------------------------------------------
// FINANCEIRO CORE
// --------------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    balance: bigint('balance', { mode: 'number' }).default(0).notNull(),
    timezone: text('time_zone').notNull().default(DEFAULT_TIMEZONE),
    closingDaysBeforeDue: integer('closing_days_before_due')
      .default(7)
      .notNull(),
    dueDay: integer('due_day'),
    creditLimit: bigint('credit_limit', { mode: 'number' }),
  },
  (table) => [
    index('idx_account_ws').on(table.workspaceId),
    index('idx_account_type').on(table.type),
    index('idx_account_closing_due').on(
      table.closingDaysBeforeDue,
      table.dueDay,
    ),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    isSystemCategory: boolean('is_system_category').default(false).notNull(),
    parentId: text('parent_id').references((): AnyPgColumn => categories.id),
  },
  (table) => [
    uniqueIndex('unq_cat_ws_name_type_parent')
      .on(table.workspaceId, table.name, table.type, table.parentId)
      .where(sql`${table.workspaceId} IS NOT NULL`),
    uniqueIndex('unq_cat_sys_name_type_parent')
      .on(table.name, table.type, table.parentId)
      .where(
        sql`${table.workspaceId} IS NULL AND ${table.isSystemCategory} = true`,
      ),
    index('categories_workspace_id_type_idx').on(table.workspaceId, table.type),
    index('categories_parent_id_idx').on(table.parentId),
    index('categories_is_system_category_idx').on(table.isSystemCategory),
  ],
);

export const recurringTransactions = pgTable(
  'recurring_transactions',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    destinationAccountId: text('destination_account_id').references(
      () => accounts.id,
      { onDelete: 'set null' },
    ),
    categoryId: text('category_id').references(() => categories.id),
    type: text('type').notNull(),

    title: text('title').notNull(),
    description: text('description'),
    amount: bigint('amount', { mode: 'number' }).notNull(),

    frequency: text('frequency').notNull(),
    interval: integer('interval').default(1).notNull(),
    installmentCount: integer('installment_count'),

    startDate: timestamp('start_date', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true, mode: 'date' }),

    lastGenerated: timestamp('last_generated', {
      withTimezone: true,
      mode: 'date',
    }),
    active: boolean('active').default(true).notNull(),
  },
  (table) => [
    index('idx_recurring_active_start').on(table.active, table.startDate),
    index('idx_recurring_workspace_active').on(table.workspaceId, table.active),
    index('idx_recurring_last_generated').on(table.lastGenerated),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .references(() => categories.id)
      .notNull(),
    title: text('title').notNull(),
    description: text('description'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    date: timestamp('date', { withTimezone: true, mode: 'date' }).notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    installmentGroupId: text('installment_group_id'),
    installmentNumber: integer('installment_number'),
    installmentCount: integer('installment_count'),
    recurringId: text('recurring_transaction_id').references(
      () => recurringTransactions.id,
    ),
    destinationAccountId: text('destination_account_id').references(
      () => accounts.id,
      { onDelete: 'set null' },
    ),
    invoicePeriodMonth: integer('invoice_period_month'),
    invoicePeriodYear: integer('invoice_period_year'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    }).$onUpdate(() => new Date()),
  },
  (table) => [
    index('transactions_workspace_id_status_date_type_idx').on(
      table.workspaceId,
      table.status,
      table.date,
      table.type,
    ),
    index('transactions_account_id_idx').on(table.accountId),
    index('transactions_workspace_id_category_id_type_date_idx').on(
      table.workspaceId,
      table.categoryId,
      table.type,
      table.date,
    ),
    index('idx_trans_destination_account').on(table.destinationAccountId),
    index('idx_trans_installment_group').on(table.installmentGroupId),
    uniqueIndex('ux_transactions_recurring_date').on(
      table.recurringId,
      table.date,
    ),
  ],
);

export const recurringSuggestions = pgTable(
  'recurring_suggestions',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    suggestedTitle: text('suggested_title').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    dayOfMonth: integer('day_of_month').notNull(),
    status: text('status').notNull(),
    recurringId: text('recurring_id').references(
      () => recurringTransactions.id,
      { onDelete: 'set null' },
    ),
    shownAt: timestamp('shown_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    }).$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_recurring_suggestion_ws_status').on(
      table.workspaceId,
      table.status,
    ),
    index('idx_recurring_suggestion_ws_category').on(
      table.workspaceId,
      table.categoryId,
    ),
  ],
);

export const recurringSuggestionTransactions = pgTable(
  'recurring_suggestion_transactions',
  {
    suggestionId: text('suggestion_id')
      .notNull()
      .references(() => recurringSuggestions.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('unq_recurring_suggestion_transaction').on(table.transactionId),
    index('idx_recurring_suggestion_transaction_suggestion').on(
      table.suggestionId,
    ),
  ],
);

export const budgets = pgTable(
  'budgets',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    monthlyIncome: bigint('monthly_income', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('unq_budget_ws_effective_from').on(
      table.workspaceId,
      table.effectiveFrom,
    ),
    index('idx_budget_ws').on(table.workspaceId),
  ],
);

export const budgetAllocations = pgTable(
  'budget_allocations',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    budgetId: text('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    groupName: text('group_name').notNull(),
    groupOrder: integer('group_order').notNull(),
    categoryOrder: integer('category_order').notNull(),
    percentageOfIncome: integer('percentage_of_income').notNull(),
    targetCents: bigint('target_cents', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('unq_budget_allocation_budget_category').on(
      table.budgetId,
      table.categoryId,
    ),
    index('idx_budget_allocation_budget').on(table.budgetId),
    index('idx_budget_allocation_category').on(table.categoryId),
  ],
);

export const balanceMovements = pgTable(
  'balance_movements',
  {
    seq: bigint('seq', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    workspaceId: text('workspace_id').notNull(),
    accountId: text('account_id').notNull(),
    transactionId: text('transaction_id'),
    cause: text('cause').$type<BalanceMovementCause>().notNull(),
    delta: bigint('delta', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    actorId: text('actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_balance_movements_account_seq').on(table.accountId, table.seq),
    uniqueIndex('ux_balance_movements_opening')
      .on(table.accountId)
      .where(sql`${table.cause} = ${sql.raw(OPENING_CAUSE_LITERAL)}`),
  ],
);

// --------------------------------------------------------
// FATURAMENTO (SAAS)
// --------------------------------------------------------

export const subscriptions = pgTable('subscriptions', {
  id: text('id')
    .primaryKey()
    .$default(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  planId: text('planId').notNull(),
  status: text('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', {
    withTimezone: true,
    mode: 'date',
  }).notNull(),
});
