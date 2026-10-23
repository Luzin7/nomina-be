export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  USER = 'USER',
  VIEWER = 'VIEWER',
}

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  TRANSFER = 'TRANSFER',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

export enum AccountType {
  CHECKING = 'CHECKING',
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  INVESTMENT = 'INVESTMENT',
}

export enum BalanceMovementCause {
  OPENING = 'OPENING',
  TRANSACTION_CREATED = 'TRANSACTION_CREATED',
  TRANSACTION_UPDATED = 'TRANSACTION_UPDATED',
  TRANSACTION_DELETED = 'TRANSACTION_DELETED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  INVOICE_PAID = 'INVOICE_PAID',
  RECONCILIATION = 'RECONCILIATION',
}

export const CLOSING_DAYS_BEFORE_DUE_OPTIONS = [5, 7, 10] as const;

export type ClosingDaysBeforeDue =
  (typeof CLOSING_DAYS_BEFORE_DUE_OPTIONS)[number];

export function isValidClosingDaysBeforeDue(
  value: number | null | undefined,
): value is ClosingDaysBeforeDue {
  return (
    value !== null &&
    value !== undefined &&
    (CLOSING_DAYS_BEFORE_DUE_OPTIONS as readonly number[]).includes(value)
  );
}

export const MIN_DUE_DAY = 1;
export const MAX_DUE_DAY = 28;

export function isValidDueDay(
  value: number | null | undefined,
): value is number {
  return (
    value !== null &&
    value !== undefined &&
    Number.isInteger(value) &&
    value >= MIN_DUE_DAY &&
    value <= MAX_DUE_DAY
  );
}

export enum RecurrenceFrequency {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum RecurringKind {
  INSTALLMENT = 'installment',
  RECURRING = 'recurring',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELED = 'CANCELED',
  PAST_DUE = 'PAST_DUE',
  TRIALING = 'TRIALING',
}

export enum RefreshTokenStatus {
  ACTIVE = 'active',
  ROTATED = 'rotated',
  REVOKED = 'revoked',
}
