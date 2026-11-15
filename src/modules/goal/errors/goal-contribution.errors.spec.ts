import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  GoalContributionIdConflictError,
  GoalContributionNotFoundError,
  GoalContributionUndoConflictError,
} from '@modules/goal/errors';

describe('goal contribution errors', () => {
  it('maps a missing contribution to 404', () => {
    expect(() =>
      ErrorPresenter.toHTTP(new GoalContributionNotFoundError()),
    ).toThrow(NotFoundException);
  });

  it('maps a replayed id of another goal to 409', () => {
    expect(() =>
      ErrorPresenter.toHTTP(new GoalContributionIdConflictError()),
    ).toThrow(ConflictException);
  });

  it('maps an undo that breaks the goal balance to 409', () => {
    expect(() =>
      ErrorPresenter.toHTTP(new GoalContributionUndoConflictError()),
    ).toThrow(ConflictException);
  });

  it('names each error by its class', () => {
    expect([
      new GoalContributionNotFoundError().name,
      new GoalContributionIdConflictError().name,
      new GoalContributionUndoConflictError().name,
    ]).toEqual([
      'GoalContributionNotFoundError',
      'GoalContributionIdConflictError',
      'GoalContributionUndoConflictError',
    ]);
  });
});
