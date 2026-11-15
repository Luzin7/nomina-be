import { BusinessRuleDomainError } from '@shared/core/errors/DomainError';

export class InvalidProjectionHorizonError extends BusinessRuleDomainError {
  constructor() {
    super(
      'O horizonte de projeção deve ser um número inteiro entre 1 e 12 meses.',
    );
  }
}
