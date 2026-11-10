import {
  BusinessRuleDomainError,
  ConflictDomainError,
  ForbiddenDomainError,
  NotFoundDomainError,
} from '@shared/core/errors/DomainError';

export interface CategoryReferenceCounts {
  transactions: number;
  allocations: number;
  recurringRules: number;
  children: number;
}

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

export class CategoryNotFoundError extends BusinessRuleDomainError {
  constructor() {
    super('Categoria não encontrada.');
  }
}

export class CategoryTargetNotFoundError extends NotFoundDomainError {
  constructor() {
    super('Categoria não encontrada.');
  }
}

export class CategoryNameAlreadyExistsError extends ConflictDomainError {
  constructor() {
    super('Já existe uma categoria com esse nome e tipo neste nível.');
  }
}

export class EmptyCategoryUpdateError extends BusinessRuleDomainError {
  constructor() {
    super('Informe ao menos um campo para atualizar a categoria.');
  }
}

export class CategoryInUseError extends ConflictDomainError {
  readonly references: CategoryReferenceCounts;

  constructor(references: CategoryReferenceCounts) {
    super(buildInUseMessage(references));
    this.references = references;
  }
}

function buildInUseMessage(references: CategoryReferenceCounts): string {
  const described = describeReferences(references);
  const reason = described ? `em uso: ${described}` : 'em uso';

  return `Não é possível excluir a categoria pois ela está ${reason}. Oculte a categoria em vez de excluí-la.`;
}

function describeReferences({
  transactions,
  allocations,
  recurringRules,
  children,
}: CategoryReferenceCounts): string {
  const parts = [
    describeCount(transactions, 'transação', 'transações'),
    describeCount(
      allocations,
      'alocação de orçamento',
      'alocações de orçamento',
    ),
    describeCount(recurringRules, 'regra recorrente', 'regras recorrentes'),
    describeCount(children, 'subcategoria', 'subcategorias'),
  ].filter((part): part is string => part !== null);

  return parts.join(', ');
}

function describeCount(
  count: number,
  singular: string,
  plural: string,
): string | null {
  if (count <= 0) return null;

  return `${count} ${count === 1 ? singular : plural}`;
}
