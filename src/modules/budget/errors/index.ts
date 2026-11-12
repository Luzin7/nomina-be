import {
  BusinessRuleDomainError,
  ConflictDomainError,
  ForbiddenDomainError,
} from '@shared/core/errors/DomainError';

export class EmptyBudgetAllocationsError extends BusinessRuleDomainError {
  constructor() {
    super('O orçamento precisa ter pelo menos uma categoria.');
  }
}

export class InvalidBudgetPercentageSumError extends BusinessRuleDomainError {
  constructor(total: number) {
    super(
      `A soma dos percentuais deve ser exatamente 100%. Valor informado: ${total}%.`,
    );
  }
}

export class DuplicateBudgetCategoryError extends BusinessRuleDomainError {
  constructor() {
    super('Cada categoria pode aparecer apenas uma vez no orçamento.');
  }
}

export class BudgetCategoryNotFoundError extends BusinessRuleDomainError {
  constructor() {
    super('Categoria não encontrada.');
  }
}

export class HiddenBudgetCategoryError extends BusinessRuleDomainError {
  constructor() {
    super(
      'Categorias ocultas só podem permanecer em um orçamento que já as aloca.',
    );
  }
}

export class HistoricalBudgetImmutableError extends BusinessRuleDomainError {
  constructor() {
    super('Não é possível alterar o orçamento de um mês passado.');
  }
}

export class InvalidBudgetEffectiveDateError extends BusinessRuleDomainError {
  constructor() {
    super('O orçamento só pode ser aplicado ao mês atual ou ao próximo mês.');
  }
}

export class ForbiddenBudgetCategoryError extends ForbiddenDomainError {
  constructor() {
    super('A categoria informada não pertence a este workspace.');
  }
}

export class BudgetSnapshotConflictError extends ConflictDomainError {
  constructor() {
    super(
      'Já existe um orçamento para este mês. Atualize a página e tente novamente.',
    );
  }
}

export class MixedBudgetModeFieldsError extends BusinessRuleDomainError {
  constructor() {
    super(
      'Envie os campos de apenas um modo de orçamento: percentuais ou valores por categoria.',
    );
  }
}

export class InvalidBudgetTargetError extends BusinessRuleDomainError {
  constructor() {
    super(
      'O valor por categoria deve ser um número inteiro de centavos maior ou igual a zero.',
    );
  }
}
