import { BadRequestException } from '@nestjs/common';
import {
  CreateGoalContributionParamsPipe,
  CreateGoalContributionPipe,
} from './create-goal-contribution.dto';

const CONTRIBUTION_ID = '7f1d1f4e-52a0-4d0c-9a53-1c3f0d6f8a11';

describe('CreateGoalContributionPipe', () => {
  it('accepts an id and a positive integer amount', () => {
    const payload = { id: CONTRIBUTION_ID, amountCents: 5_000 };

    expect(CreateGoalContributionPipe.transform(payload)).toEqual(payload);
  });

  it('accepts a source account id', () => {
    const payload = {
      id: CONTRIBUTION_ID,
      amountCents: 5_000,
      sourceAccountId: 'account-1',
    };

    expect(CreateGoalContributionPipe.transform(payload)).toEqual(payload);
  });

  it('rejects a missing id', () => {
    expect(() =>
      CreateGoalContributionPipe.transform({ amountCents: 5_000 }),
    ).toThrow(BadRequestException);
  });

  it('rejects an id that is not a uuid', () => {
    expect(() =>
      CreateGoalContributionPipe.transform({
        id: 'not-a-uuid',
        amountCents: 5_000,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a zero amount', () => {
    expect(() =>
      CreateGoalContributionPipe.transform({
        id: CONTRIBUTION_ID,
        amountCents: 0,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a negative amount', () => {
    expect(() =>
      CreateGoalContributionPipe.transform({
        id: CONTRIBUTION_ID,
        amountCents: -1,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a fractional amount', () => {
    expect(() =>
      CreateGoalContributionPipe.transform({
        id: CONTRIBUTION_ID,
        amountCents: 10.5,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an amount above the safe integer range', () => {
    expect(() =>
      CreateGoalContributionPipe.transform({
        id: CONTRIBUTION_ID,
        amountCents: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a missing amount', () => {
    expect(() =>
      CreateGoalContributionPipe.transform({ id: CONTRIBUTION_ID }),
    ).toThrow(BadRequestException);
  });
});

describe('CreateGoalContributionParamsPipe', () => {
  it('rejects an empty goal id', () => {
    expect(() =>
      CreateGoalContributionParamsPipe.transform({ id: '' }),
    ).toThrow(BadRequestException);
  });
});
