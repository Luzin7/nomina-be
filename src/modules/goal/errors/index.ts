import {
  BusinessRuleDomainError,
  ConflictDomainError,
  NotFoundDomainError,
} from '@shared/core/errors/DomainError';

export class GoalNotFoundError extends NotFoundDomainError {
  constructor() {
    super('Meta não encontrada.');
  }
}

export class EmergencyGoalNotDeletableError extends ConflictDomainError {
  constructor() {
    super(
      'A reserva de emergência não pode ser excluída. Redefina os valores dela.',
    );
  }
}

export class InvalidGoalNameError extends BusinessRuleDomainError {
  constructor() {
    super('O nome da meta deve ter entre 1 e 60 caracteres.');
  }
}

export class GoalLinkedAccountInvalidError extends BusinessRuleDomainError {
  constructor() {
    super('A conta vinculada não pertence a este workspace.');
  }
}

export class GoalCategoryInvalidError extends BusinessRuleDomainError {
  constructor() {
    super('A categoria informada não pertence a este workspace.');
  }
}

export class GoalContributionNotFoundError extends NotFoundDomainError {
  constructor() {
    super('Aporte não encontrado.');
  }
}

export class GoalContributionIdConflictError extends ConflictDomainError {
  constructor() {
    super('Este identificador de aporte já pertence a outra meta.');
  }
}

export class GoalContributionUndoConflictError extends ConflictDomainError {
  constructor() {
    super(
      'Não é possível desfazer este aporte: o valor atual da meta ficaria negativo.',
    );
  }
}
