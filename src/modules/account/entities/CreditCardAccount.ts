import { AccountType } from '@constants/enums';
import {
  CreditLimitExceededError,
  PaymentExceedsInvoiceBalanceError,
  ValidationAccountError,
} from '@modules/account/errors';
import { Either, left, right } from '@shared/core/errors/Either';
import { BaseAccount, BaseAccountProps } from './BaseAccount';

export interface CreditCardProps extends BaseAccountProps {
  balance: bigint;
  creditLimit: bigint | null;
  closingDaysBeforeDue: number;
  dueDay: number;
}

export class CreditCard extends BaseAccount<CreditCardProps> {
  private constructor(props: CreditCardProps, id?: string) {
    super(props, id);
  }

  static create(
    props: Omit<CreditCardProps, 'balance'> & { balance?: bigint },
    id?: string,
  ): Either<Error, CreditCard> {
    if (
      props.creditLimit !== null &&
      props.creditLimit !== undefined &&
      props.creditLimit <= 0n
    ) {
      return left(
        new ValidationAccountError(
          'O limite de crédito deve ser superior a zero.',
        ),
      );
    }
    if (
      props.closingDaysBeforeDue !== null &&
      props.closingDaysBeforeDue !== undefined &&
      (props.closingDaysBeforeDue < 5 || props.closingDaysBeforeDue > 10)
    ) {
      return left(new ValidationAccountError('Dia de fechamento inválido.'));
    }
    if (props.dueDay < 1 || props.dueDay > 28) {
      return left(new ValidationAccountError('Dia de vencimento inválido.'));
    }

    return right(
      new CreditCard(
        {
          ...props,
          creditLimit: props.creditLimit ?? null,
          closingDaysBeforeDue: props.closingDaysBeforeDue ?? null,
          balance: props.balance ?? 0n,
        },
        id,
      ),
    );
  }

  static reconstitute(props: CreditCardProps, id: string): CreditCard {
    return new CreditCard(props, id);
  }

  get creditLimit(): bigint | null {
    return this.props.creditLimit;
  }

  get closingDaysBeforeDue(): number {
    return this.props.closingDaysBeforeDue;
  }

  get dueDay(): number {
    return this.props.dueDay;
  }

  get type(): string {
    return AccountType.CREDIT_CARD;
  }

  get availableLimit(): bigint | null {
    if (this.props.creditLimit === null) return null;
    return this.props.creditLimit - this.props.balance;
  }

  get patrimonyContribution(): bigint {
    return -this.balance;
  }

  public registerCharge(amount: bigint): Either<Error, void> {
    if (amount <= 0n) {
      return left(
        new ValidationAccountError(
          'O valor da cobrança deve ser maior que zero.',
        ),
      );
    }
    if (this.props.creditLimit !== null && amount > this.availableLimit!) {
      return left(new CreditLimitExceededError(this.availableLimit!, amount));
    }

    this.props.balance += amount;
    return right(undefined);
  }

  public payInvoice(amount: bigint): Either<Error, void> {
    if (amount <= 0n) {
      return left(
        new ValidationAccountError(
          'O valor do pagamento deve ser maior que zero.',
        ),
      );
    }

    if (this.props.balance - amount < 0n) {
      return left(new PaymentExceedsInvoiceBalanceError());
    }

    this.props.balance -= amount;
    return right(undefined);
  }

  public applyExpenseEffect(amount: bigint): Either<Error, void> {
    return this.registerCharge(amount);
  }

  public applyIncomeEffect(amount: bigint): Either<Error, void> {
    return this.payInvoice(amount);
  }

  public updateInvoiceDates(
    closingDaysBeforeDue: number,
    dueDay: number,
  ): Either<Error, void> {
    if (
      closingDaysBeforeDue !== null &&
      (closingDaysBeforeDue < 1 || closingDaysBeforeDue > 10)
    ) {
      return left(new ValidationAccountError('Dia de fechamento inválido.'));
    }
    if (dueDay < 1 || dueDay > 28) {
      return left(new ValidationAccountError('Dia de vencimento inválido.'));
    }
    this.props.closingDaysBeforeDue = closingDaysBeforeDue;
    this.props.dueDay = dueDay;
    return right(undefined);
  }

  public adjustLimit(newLimit: bigint | null): Either<Error, void> {
    if (newLimit !== null && newLimit <= 0n) {
      return left(
        new ValidationAccountError(
          'O limite de crédito deve ser superior a zero.',
        ),
      );
    }
    this.props.creditLimit = newLimit;
    return right(undefined);
  }
}
