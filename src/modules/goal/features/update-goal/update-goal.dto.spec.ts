import { BadRequestException } from '@nestjs/common';
import { UpdateGoalPipe } from './update-goal.dto';

describe('UpdateGoalPipe', () => {
  it('accepts an empty payload', () => {
    expect(UpdateGoalPipe.transform({})).toEqual({});
  });

  it('accepts a zero target, which returns the goal to unconfigured', () => {
    expect(UpdateGoalPipe.transform({ targetCents: 0 })).toEqual({
      targetCents: 0,
    });
  });

  it('accepts null links, which unlinks them', () => {
    const payload = { linkedAccountId: null, categoryId: null };

    expect(UpdateGoalPipe.transform(payload)).toEqual(payload);
  });

  it('rejects a negative target', () => {
    expect(() => UpdateGoalPipe.transform({ targetCents: -1 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a fractional target', () => {
    expect(() => UpdateGoalPipe.transform({ targetCents: 10.5 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a non boolean dismissal', () => {
    expect(() => UpdateGoalPipe.transform({ dismissed: 'true' })).toThrow(
      BadRequestException,
    );
  });

  it('does not accept the system flags', () => {
    const parsed = UpdateGoalPipe.transform({
      isEmergency: true,
      isSystem: true,
    });

    expect(parsed).not.toHaveProperty('isEmergency');
    expect(parsed).not.toHaveProperty('isSystem');
  });
});
