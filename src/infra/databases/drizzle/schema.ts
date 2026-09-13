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

// --------------------------------------------------------
// INFRAESTRUTURA & AUTH
// --------------------------------------------------------

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$default(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
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

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    token: text('token').notNull(),
    expiresIn: timestamp('expires_in', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [index('idx_refresh_token_user_id').on(table.userId)],
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
  timezone: text('time_zone').default('America/Sao_Paulo').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
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
    timezone: text('time_zone').notNull().default('America/Sao_Paulo'),
    isDefault: boolean('is_default').default(false).notNull(),
    role: text('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('unq_workspace_user').on(table.workspaceId, table.userId),
    index('idx_wu_user_default').on(table.userId, table.isDefault),
  ],
);

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: text('id')
      .primaryKey()
      .$default(() => crypto.randomUUID()),
    code: text('code').notNull().unique(),
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
    index('idx_invite_code').on(table.code),
    index('idx_invite_ws_expires').on(table.workspaceId, table.expiresAt),
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
    timezone: text('time_zone').notNull().default('America/Sao_Paulo'),
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
    uniqueIndex('unq_cat_ws_name_type_parent').on(
      table.workspaceId,
      table.name,
      table.type,
      table.parentId,
    ),
    index('idx_cat_ws_type').on(table.workspaceId, table.type),
    index('idx_cat_parent').on(table.parentId),
    index('idx_cat_system').on(table.isSystemCategory),
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
    categoryId: text('category_id')
      .references(() => categories.id)
      .notNull(),
    type: text('type').notNull(),

    title: text('title').notNull(),
    description: text('description'),
    amount: bigint('amount', { mode: 'number' }).notNull(),

    frequency: text('frequency').notNull(),
    interval: integer('interval').default(1).notNull(),

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
    index('idx_trans_ws_date_status_type').on(
      table.workspaceId,
      table.date,
      table.status,
      table.type,
    ),
    index('idx_trans_account').on(table.accountId),
    index('idx_trans_category_filter').on(
      table.workspaceId,
      table.categoryId,
      table.type,
      table.date,
    ),
    index('idx_trans_destination_account').on(table.destinationAccountId),
    index('idx_trans_installment_group').on(table.installmentGroupId),
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
