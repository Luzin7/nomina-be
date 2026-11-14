import {
  BusinessRuleDomainError,
  ConflictDomainError,
  NotFoundDomainError,
} from '@shared/core/errors/DomainError';
import {
  CategoryInUseError,
  CategoryNameAlreadyExistsError,
  CategoryNotFoundError,
  CategoryTargetNotFoundError,
  EmptyCategoryUpdateError,
} from './index';

describe('category errors', () => {
  it('should map CategoryNotFoundError to a business rule violation', () => {
    expect(new CategoryNotFoundError()).toBeInstanceOf(BusinessRuleDomainError);
  });

  it('should map CategoryTargetNotFoundError to not found', () => {
    expect(new CategoryTargetNotFoundError()).toBeInstanceOf(
      NotFoundDomainError,
    );
  });

  it('should map CategoryNameAlreadyExistsError to conflict', () => {
    expect(new CategoryNameAlreadyExistsError()).toBeInstanceOf(
      ConflictDomainError,
    );
  });

  it('should map EmptyCategoryUpdateError to business rule', () => {
    expect(new EmptyCategoryUpdateError()).toBeInstanceOf(
      BusinessRuleDomainError,
    );
  });

  it('should map CategoryInUseError to conflict and carry the counts', () => {
    const references = {
      transactions: 3,
      allocations: 0,
      recurringRules: 1,
      children: 0,
    };

    const error = new CategoryInUseError(references);

    expect(error).toBeInstanceOf(ConflictDomainError);
    expect(error.references).toEqual(references);
  });

  it('should name only the non-zero references and recommend hiding', () => {
    const message = new CategoryInUseError({
      transactions: 3,
      allocations: 0,
      recurringRules: 1,
      children: 0,
    }).message;

    expect(message).toContain('3 transações');
    expect(message).toContain('1 regra recorrente');
    expect(message).not.toContain('alocação');
    expect(message).not.toContain('subcategoria');
    expect(message).toContain('Oculte a categoria');
  });

  it('should use the singular for a single reference', () => {
    const message = new CategoryInUseError({
      transactions: 0,
      allocations: 0,
      recurringRules: 0,
      children: 1,
    }).message;

    expect(message).toContain('1 subcategoria');
    expect(message).not.toContain('1 subcategorias');
  });

  it('should stay readable when no reference could be counted', () => {
    const message = new CategoryInUseError({
      transactions: 0,
      allocations: 0,
      recurringRules: 0,
      children: 0,
    }).message;

    expect(message).toContain('em uso');
    expect(message).toContain('Oculte a categoria');
    expect(message).not.toContain(':');
  });
});
