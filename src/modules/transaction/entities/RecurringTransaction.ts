import { RecurrenceFrequency, TransactionType } from '@constants/enums';
import { AggregateRoot } from '@shared/core/Entities/AggregateRoot';
import { Either, left, right } from '@shared/core/errors/Either';
import { Optional } from '@shared/core/types/Optional';
import {
  InvalidAmountError,
  InvalidDateRangeError,
  InvalidRecurrenceIntervalError,
  InvalidTransferError,
  MissingCategoryError,
} from '../errors';

export interface RecurringTransactionProps {
  workspaceId: string;
  accountId: string;
  destinationAccountId: string | null;
  categoryId: string;
  title: string;
  description: string | null;
  amount: bigint;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  lastGenerated: Date | null;
  active: boolean;
  type: keyof typeof TransactionType;
}

export class RecurringTransaction extends AggregateRoot<RecurringTransactionProps> {
  private constructor(props: RecurringTransactionProps, id?: string) {
    super(props, id);
  }

  static create(
    props: Optional<
      RecurringTransactionProps,
      | 'interval'
      | 'endDate'
      | 'lastGenerated'
      | 'active'
      | 'description'
      | 'destinationAccountId'
    >,
    id?: string,
  ): Either<Error, RecurringTransaction> {
    if (props.amount <= 0n) return left(new InvalidAmountError());
    if (props.interval !== undefined && props.interval <= 0)
      return left(new InvalidRecurrenceIntervalError());

    if (!props.categoryId) {
      return left(new MissingCategoryError());
    }

    if (props.endDate && props.endDate < props.startDate) {
      return left(new InvalidDateRangeError());
    }

    if (props.type === 'TRANSFER') {
      if (!props.destinationAccountId) {
        return left(new InvalidTransferError('Conta destino é obrigatória.'));
      }
      if (props.destinationAccountId === props.accountId) {
        return left(
          new InvalidTransferError(
            'Conta destino deve ser diferente da origem.',
          ),
        );
      }
    }

    const recurringTransactionProps: RecurringTransactionProps = {
      ...props,
      destinationAccountId: props.destinationAccountId ?? null,
      description: props.description ?? null,
      categoryId: props.categoryId,
      interval: props.interval ?? 1,
      endDate: props.endDate ?? null,
      lastGenerated: props.lastGenerated ?? null,
      active: props.active ?? true,
    };

    return right(new RecurringTransaction(recurringTransactionProps, id));
  }

  static restore(
    props: RecurringTransactionProps,
    id: string,
  ): RecurringTransaction {
    return new RecurringTransaction(props, id);
  }

  get workspaceId(): string {
    return this.props.workspaceId;
  }

  get type(): keyof typeof TransactionType {
    return this.props.type;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get destinationAccountId(): string | null {
    return this.props.destinationAccountId;
  }

  get categoryId(): string {
    return this.props.categoryId;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string | null {
    return this.props.description;
  }

  get amount(): bigint {
    return this.props.amount;
  }

  get frequency(): RecurrenceFrequency {
    return this.props.frequency;
  }

  get interval(): number {
    return this.props.interval;
  }

  get startDate(): Date {
    return this.props.startDate;
  }

  get endDate(): Date | null {
    return this.props.endDate;
  }

  get lastGenerated(): Date | null {
    return this.props.lastGenerated;
  }

  get active(): boolean {
    return this.props.active;
  }

  get amountDecimal(): number {
    return Number(this.props.amount) / 100;
  }

  public updateDetails(
    title: string,
    description: string | null,
    categoryId: string,
  ): void {
    if (!title || title.trim() === '')
      throw new Error('O título é obrigatório.');
    this.props.title = title;
    this.props.description = description;
    this.props.categoryId = categoryId;
  }

  public updateAmount(newAmount: bigint): Either<Error, void> {
    if (newAmount <= 0n) return left(new InvalidAmountError());
    this.props.amount = newAmount;
    return right(undefined);
  }

  public updateSchedule(
    startDate: Date,
    endDate: Date | null,
    frequency: RecurrenceFrequency,
    interval: number,
  ): Either<Error, void> {
    if (interval <= 0) return left(new InvalidRecurrenceIntervalError());
    if (endDate && endDate < startDate)
      return left(new InvalidDateRangeError());

    this.props.startDate = startDate;
    this.props.endDate = endDate;
    this.props.frequency = frequency;
    this.props.interval = interval;
    return right(undefined);
  }

  public convertToTransfer(destinationAccountId: string): Either<Error, void> {
    if (!destinationAccountId)
      return left(new InvalidTransferError('Conta destino é obrigatória.'));
    if (destinationAccountId === this.props.accountId)
      return left(
        new InvalidTransferError('Conta destino deve ser diferente da origem.'),
      );

    this.props.type = 'TRANSFER';
    this.props.destinationAccountId = destinationAccountId;
    return right(undefined);
  }

  public convertToIncomeOrExpense(type: 'INCOME' | 'EXPENSE'): void {
    this.props.type = type;
    this.props.destinationAccountId = null;
  }

  public markAsGenerated(generationDate: Date): void {
    this.props.lastGenerated = generationDate;
  }

  public deactivate(): void {
    this.props.active = false;
  }

  public activate(): void {
    this.props.active = true;
  }
}
