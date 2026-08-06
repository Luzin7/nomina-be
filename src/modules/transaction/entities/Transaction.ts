import { TransactionStatus, TransactionType } from '@constants/enums';
import { AggregateRoot } from '@shared/core/Entities/AggregateRoot';
import { Either, left, right } from '@shared/core/errors/Either';
import { Optional } from '@shared/core/types/Optional';
import { MissingCategoryError } from '../errors';

export interface TransactionProps {
  workspaceId: string;
  accountId: string;
  categoryId: string;
  destinationAccountId: string | null;
  title: string;
  description: string | null;
  amount: bigint;
  date: Date;
  type: keyof typeof TransactionType;
  status: TransactionStatus;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  recurringId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export class Transaction extends AggregateRoot<TransactionProps> {
  private constructor(props: TransactionProps, id?: string) {
    super(props, id);
  }

  static create(
    props: Optional<
      TransactionProps,
      | 'createdAt'
      | 'updatedAt'
      | 'status'
      | 'recurringId'
      | 'description'
      | 'destinationAccountId'
      | 'installmentGroupId'
      | 'installmentNumber'
      | 'installmentCount'
    >,
    id?: string,
  ): Either<Error, Transaction> {
    if (props.amount <= 0n) {
      return left(new Error('The amount must be greater than zero')); // Substituir por DomainError
    }

    if (!props.title || props.title.trim() === '') {
      return left(new Error('The title is required'));
    }

    if (!props.categoryId) {
      return left(new MissingCategoryError());
    }

    if (!props.status) return left(new Error('O status é obrigatório'));

    if (!props.date) {
      return left(new Error('The date is required'));
    }

    if (!props.type) {
      return left(new Error('The type is required'));
    }

    if (props.type === 'TRANSFER') {
      if (!props.destinationAccountId) {
        return left(
          new Error('Conta destino é obrigatória para transferências'),
        );
      }
      if (props.destinationAccountId === props.accountId) {
        return left(
          new Error('Conta destino deve ser diferente da conta origem'),
        );
      }
    }

    const status =
      props.date > new Date()
        ? TransactionStatus.PENDING
        : TransactionStatus.COMPLETED;

    const transactionProps: TransactionProps = {
      ...props,
      categoryId: props.categoryId,
      destinationAccountId: props.destinationAccountId ?? null,
      description: props.description ?? null,
      createdAt: props.createdAt ?? new Date(),
      updatedAt: props.updatedAt ?? null,
      status,
      recurringId: props.recurringId ?? null,
      installmentGroupId: props.installmentGroupId ?? null,
      installmentNumber: props.installmentNumber ?? null,
      installmentCount: props.installmentCount ?? null,
    };

    return right(new Transaction(transactionProps, id));
  }

  static restore(props: TransactionProps, id?: string): Transaction {
    return new Transaction(props, id);
  }

  get workspaceId(): string {
    return this.props.workspaceId;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get categoryId(): string {
    return this.props.categoryId;
  }

  get destinationAccountId(): string | null {
    return this.props.destinationAccountId;
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

  get amountDecimal(): number {
    return Number(this.props.amount) / 100;
  }

  get date(): Date {
    return this.props.date;
  }

  get type(): keyof typeof TransactionType {
    return this.props.type;
  }

  get status(): TransactionStatus {
    return this.props.status;
  }

  get recurringId(): string | null {
    return this.props.recurringId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date | null {
    return this.props.updatedAt;
  }

  get installmentGroupId(): string | null {
    return this.props.installmentGroupId;
  }

  get installmentNumber(): number | null {
    return this.props.installmentNumber;
  }

  get installmentCount(): number | null {
    return this.props.installmentCount;
  }

  /**
   * Reflete a intenção de corrigir os dados básicos de uma transação em uma única operação.
   */
  public updateDetails(
    title: string,
    description: string | null,
  ): Either<Error, void> {
    if (!title || title.trim() === '') {
      return left(new Error('The title is required'));
    }
    this.props.title = title;
    this.props.description = description;
    this.touch();
    return right(undefined);
  }

  /**
   * Alterar o valor não é apenas mudar um número, exige validação da regra de negócio.
   */
  public correctAmount(newAmount: bigint): Either<Error, void> {
    if (newAmount <= 0n) {
      return left(new Error('The amount must be greater than zero'));
    }
    this.props.amount = newAmount;
    this.touch();
    return right(undefined);
  }

  /**
   * Reclassificação financeira tem semântica própria.
   */
  public reclassify(newCategoryId: string): void {
    this.props.categoryId = newCategoryId;
    this.touch();
  }

  /**
   * A data pode impactar o status. Se remarcada para o futuro, volta para PENDING.
   */
  public reschedule(newDate: Date): Either<Error, void> {
    if (!newDate) {
      return left(new Error('The date is required'));
    }
    this.props.date = newDate;

    if (
      newDate > new Date() &&
      this.props.status === TransactionStatus.COMPLETED
    ) {
      this.props.status = TransactionStatus.PENDING;
    }

    this.touch();
    return right(undefined);
  }

  /**
   * Operações de ciclo de vida do status da transação.
   */
  public complete(): Either<Error, void> {
    if (this.props.status === TransactionStatus.COMPLETED) {
      return left(new Error('Transaction is already completed'));
    }
    this.props.status = TransactionStatus.COMPLETED;
    this.touch();
    return right(undefined);
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }

  public markAsPending(): Either<Error, void> {
    if (this.props.status === TransactionStatus.PENDING) {
      return left(new Error('A transação já está pendente.'));
    }
    this.props.status = TransactionStatus.PENDING;
    this.touch();
    return right(undefined);
  }
}
