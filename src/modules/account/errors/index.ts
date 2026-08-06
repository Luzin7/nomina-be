import {
  CLOSING_DAYS_BEFORE_DUE_OPTIONS,
  MAX_DUE_DAY,
  MIN_DUE_DAY,
} from '@constants/enums';
import {
  BusinessRuleDomainError,
  ConflictDomainError,
  NotFoundDomainError,
} from '@shared/core/errors/DomainError';

export class AccountNotFoundError extends NotFoundDomainError {
  constructor(reason?: string) {
    super(`Conta não encontrada: ${reason || 'Não existe.'}`);
  }
}

export class AccountTypeError extends BusinessRuleDomainError {
  constructor(reason?: string) {
    super(
      `Tipo de conta inválido: ${reason || 'Tipo não permitido para essa operação.'}`,
    );
  }
}

export class ConflictAccountError extends ConflictDomainError {
  constructor(reason: string) {
    super(`Conflito de conta: ${reason}`);
  }
}

export class CreditLimitExceededError extends BusinessRuleDomainError {
  constructor(available: bigint, requested: bigint) {
    super(
      `Limite insuficiente. Disponível: ${available}, Requisitado: ${requested}`,
    );
  }
}

export class InvalidAccountError extends BusinessRuleDomainError {
  constructor(reason: string) {
    super(`Conta inválida: ${reason}`);
  }
}

export class ValidationAccountError extends BusinessRuleDomainError {
  constructor(reason: string) {
    super(`Erro de validação na conta: ${reason}`);
  }
}

export class InvalidClosingDaysBeforeDueError extends ValidationAccountError {
  constructor() {
    super(
      `O fechamento da fatura deve ser ${CLOSING_DAYS_BEFORE_DUE_OPTIONS.join(', ')} dias antes do vencimento.`,
    );
  }
}

export class InvalidDueDayError extends ValidationAccountError {
  constructor() {
    super(
      `O dia de vencimento deve estar entre ${MIN_DUE_DAY} e ${MAX_DUE_DAY}.`,
    );
  }
}

export class InsufficientBalanceError extends BusinessRuleDomainError {
  constructor(reason = 'Saldo insuficiente para essa operação.') {
    super(reason);
  }
}

export class PaymentExceedsInvoiceBalanceError extends BusinessRuleDomainError {
  constructor() {
    super('O pagamento não pode exceder o valor da fatura atual.');
  }
}
