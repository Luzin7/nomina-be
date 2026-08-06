import {
  BusinessRuleDomainError,
  ForbiddenDomainError,
} from '@shared/core/errors/DomainError';

export class InvalidCategoryNameError extends BusinessRuleDomainError {
  constructor() {
    super('O nome da categoria é obrigatório e não pode ser vazio.');
  }
}

export class InvalidCategoryTypeError extends BusinessRuleDomainError {
  constructor() {
    super('O tipo da categoria é obrigatório.');
  }
}

export class SystemCategoryModificationError extends ForbiddenDomainError {
  constructor() {
    super('Categorias padrões do sistema não podem ser modificadas.');
  }
}

export class InvalidParentCategoryError extends BusinessRuleDomainError {
  constructor(reason: string) {
    super(`Hierarquia de categoria inválida: ${reason}`);
  }
}

export class CategoryHasTransactionsError extends BusinessRuleDomainError {
  constructor() {
    super(
      'Não é possível excluir a categoria pois ela possui transações vinculadas.',
    );
  }
}

export class CategoryNotFoundError extends BusinessRuleDomainError {
  constructor() {
    super('Categoria não encontrada.');
  }
}

export class ConflictCategoryError extends Error {
  constructor(reason: string) {
    super(`Conflito na operação de categoria: ${reason}`);
  }
}

export class CategoryHasChildrenError extends Error {
  constructor() {
    super('Não é possível excluir a categoria pois ela possui subcategorias.');
  }
}
