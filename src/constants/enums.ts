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

/**
 * Fechamento da fatura não é um dia fixo do mês: é a distância, em dias, entre
 * o fechamento e o vencimento. As instituições que a Nomina suporta trabalham
 * com apenas três intervalos, então o valor é um conjunto fechado — validado
 * igual na entidade, nos DTOs e no formulário do app.
 */
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

/**
 * Vencimento limitado ao dia 28 para que todo mês do calendário tenha o dia,
 * evitando o ajuste silencioso de fevereiro.
 */
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

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELED = 'CANCELED',
  PAST_DUE = 'PAST_DUE',
  TRIALING = 'TRIALING',
}
