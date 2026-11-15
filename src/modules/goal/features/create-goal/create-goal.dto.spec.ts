import { BadRequestException } from '@nestjs/common';
import { CreateGoalPipe } from './create-goal.dto';

const VALID_PAYLOAD = {
  name: 'Viagem',
  targetCents: 600_000,
};

describe('CreateGoalPipe', () => {
  it('accepts the required fields', () => {
    expect(CreateGoalPipe.transform(VALID_PAYLOAD)).toEqual(VALID_PAYLOAD);
  });

  it('rejects a missing name', () => {
    expect(() => CreateGoalPipe.transform({ targetCents: 600_000 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a zero target', () => {
    expect(() =>
      CreateGoalPipe.transform({ name: 'Viagem', targetCents: 0 }),
    ).toThrow(BadRequestException);
  });

  it('rejects a negative target', () => {
    expect(() =>
      CreateGoalPipe.transform({ name: 'Viagem', targetCents: -1 }),
    ).toThrow(BadRequestException);
  });

  it('rejects a fractional target', () => {
    expect(() =>
      CreateGoalPipe.transform({ name: 'Viagem', targetCents: 10.5 }),
    ).toThrow(BadRequestException);
  });

  it('rejects a target above the safe integer range', () => {
    expect(() =>
      CreateGoalPipe.transform({
        name: 'Viagem',
        targetCents: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a negative monthly aporte', () => {
    expect(() =>
      CreateGoalPipe.transform({ ...VALID_PAYLOAD, monthlyAporteCents: -1 }),
    ).toThrow(BadRequestException);
  });
});
