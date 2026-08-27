import {
  BusinessRuleDomainError,
  InvalidOperationDomainError,
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

export class TransactionAlreadyCompletedError extends InvalidOperationDomainError {
  constructor() {
    super('A transação já está concluída.');
  }
}

export class TransactionAlreadyPendingError extends InvalidOperationDomainError {
  constructor() {
    super('A transação já está pendente.');
  }
}
