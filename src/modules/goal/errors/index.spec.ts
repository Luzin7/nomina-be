import {
  BusinessRuleDomainError,
  ConflictDomainError,
  NotFoundDomainError,
} from '@shared/core/errors/DomainError';
import {
  EmergencyGoalNotDeletableError,
  GoalLinkedAccountInvalidError,
  GoalNotFoundError,
  InvalidGoalNameError,
} from './index';

describe('goal errors', () => {
  it('maps GoalNotFoundError to not found', () => {
    expect(new GoalNotFoundError()).toBeInstanceOf(NotFoundDomainError);
  });

  it('maps EmergencyGoalNotDeletableError to conflict', () => {
    expect(new EmergencyGoalNotDeletableError()).toBeInstanceOf(
      ConflictDomainError,
    );
  });

  it('maps InvalidGoalNameError to a business rule violation', () => {
    expect(new InvalidGoalNameError()).toBeInstanceOf(BusinessRuleDomainError);
  });

  it('maps GoalLinkedAccountInvalidError to a business rule violation', () => {
    expect(new GoalLinkedAccountInvalidError()).toBeInstanceOf(
      BusinessRuleDomainError,
    );
  });
});
