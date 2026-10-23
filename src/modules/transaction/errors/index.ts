import {
  BusinessRuleDomainError,
  ConflictDomainError,
  DomainError,
} from '@shared/core/errors/DomainError';

export class InvalidAmountError extends BusinessRuleDomainError {
  constructor() {
    super('O valor da transação deve ser maior que zero.');
  }
}
export class InvalidRecurrenceIntervalError extends BusinessRuleDomainError {
  constructor() {
    super('O intervalo de recorrência deve ser maior que zero.');
  }
}
export class MissingCategoryError extends BusinessRuleDomainError {
  constructor() {
    super('A categoria é obrigatória.');
  }
}
export class InvalidTransferError extends BusinessRuleDomainError {
  constructor(reason: string) {
    super(`Transferência inválida: ${reason}`);
  }
}
export class InvalidDateRangeError extends BusinessRuleDomainError {
  constructor() {
    super('A data de término não pode ser anterior à data de início.');
  }
}

export class StartDateCannotBeTodayOrPastError extends BusinessRuleDomainError {
  constructor() {
    super('A data de início deve ser no futuro.');
  }
}

export class EndDateMustBeInTheFutureError extends BusinessRuleDomainError {
  constructor() {
    super('A data de término deve ser no futuro.');
  }
}

export class RecurringTransactionNotFoundError extends BusinessRuleDomainError {
  constructor() {
    super('Transação recorrente não encontrada.');
  }
}

export class DestinationAccountRequiredForTransferError extends BusinessRuleDomainError {
  constructor() {
    super('Conta destino é obrigatória para transações do tipo transferência.');
  }
}

export class CreditCardTransferNotAllowedError extends BusinessRuleDomainError {
  constructor() {
    super(
      'Transferência para cartão de crédito não é permitida. Use o pagamento de fatura.',
    );
  }
}

export class InvestmentAccountNotAllowedError extends BusinessRuleDomainError {
  constructor() {
    super('Compra parcelada não é permitida em conta de investimento.');
  }
}

export class InstallmentCountOutOfRangeError extends BusinessRuleDomainError {
  constructor(min: number, max: number) {
    super(`O número de parcelas deve estar entre ${min} e ${max}.`);
  }
}

export class SourceAndDestinationAccountMustBeDifferentError extends BusinessRuleDomainError {
  constructor() {
    super(
      'Conta origem e destino devem ser diferentes para transações do tipo transferência.',
    );
  }
}

export class TransactionNotFoundError extends BusinessRuleDomainError {
  constructor() {
    super('Transação não encontrada.');
  }
}

export class CannotPayInvoiceWithCreditCardError extends BusinessRuleDomainError {
  constructor() {
    super('Não é possível pagar uma fatura usando outro cartão de crédito.');
  }
}

export class CannotRemoveDestinationAccountError extends BusinessRuleDomainError {
  constructor() {
    super(
      'Não é possível remover a conta destino de uma transferência diretamente. Converta a transação para receita ou despesa primeiro.',
    );
  }
}

export class TitleRequiredError extends BusinessRuleDomainError {
  constructor() {
    super('O título da transação é obrigatório.');
  }
}

export class StatusRequiredError extends BusinessRuleDomainError {
  constructor() {
    super('O status da transação é obrigatório.');
  }
}

export class DateRequiredError extends BusinessRuleDomainError {
  constructor() {
    super('A data da transação é obrigatória.');
  }
}

export class TypeRequiredError extends BusinessRuleDomainError {
  constructor() {
    super('O tipo da transação é obrigatório.');
  }
}

export class TransactionAlreadyCompletedError extends ConflictDomainError {
  constructor() {
    super('A transação já está concluída.');
  }
}

export class TransactionAlreadyPendingError extends ConflictDomainError {
  constructor() {
    super('A transação já está pendente.');
  }
}

export class TransactionStatusChangedConcurrentlyError extends ConflictDomainError {
  constructor() {
    super(
      'O status da transação foi alterado por outra requisição. Tente novamente.',
    );
  }
}

export class RecurringGenerationFailedError extends DomainError {
  constructor(reason: string) {
    super(`Falha ao gerar transações recorrentes: ${reason}`);
  }
}

export class CardInstallmentSettlementFailedError extends DomainError {
  constructor(failedCount: number, processedCount: number) {
    super(
      `Falha ao liquidar parcelas de cartão: ${failedCount} de ${processedCount} falharam.`,
    );
  }
}

export class UnknownRecurrenceFrequencyError extends DomainError {
  constructor(frequency: string) {
    super(`Frequência de recorrência desconhecida: ${frequency}`);
  }
}

export interface BalanceDivergencePayload {
  accountId: string;
  unexplained: number;
}

export class BalanceLedgerUncoveredError extends DomainError {
  readonly uncovered: number;
  readonly accountIds: readonly string[];

  constructor(uncovered: number, accountIds: readonly string[]) {
    super('Contas sem movimentação de abertura não podem ser conciliadas.');
    this.uncovered = uncovered;
    this.accountIds = accountIds;
  }
}

export class BalanceReconciliationDivergenceError extends DomainError {
  readonly divergences: readonly BalanceDivergencePayload[];

  constructor(divergences: readonly BalanceDivergencePayload[]) {
    super('Divergência entre o saldo das contas e o ledger de movimentações.');
    this.divergences = divergences;
  }
}
