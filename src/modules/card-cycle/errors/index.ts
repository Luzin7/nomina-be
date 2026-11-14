import {
  BusinessRuleDomainError,
  ConflictDomainError,
} from '@shared/core/errors/DomainError';

export class CardCycleNotConfiguredError extends BusinessRuleDomainError {
  constructor() {
    super('O cartão não tem dia de vencimento configurado.');
  }
}

export class InvalidCardCycleLimitError extends BusinessRuleDomainError {
  constructor() {
    super(
      'O limite do ciclo deve ser um número inteiro de centavos maior ou igual a zero.',
    );
  }
}

export class HistoricalCardCycleBudgetError extends BusinessRuleDomainError {
  constructor() {
    super('Não é possível alterar o limite de um ciclo passado.');
  }
}

export class CardCycleBudgetExistsError extends ConflictDomainError {
  constructor() {
    super(
      'Já existe um limite para este ciclo. Atualize a página e tente novamente.',
    );
  }
}
