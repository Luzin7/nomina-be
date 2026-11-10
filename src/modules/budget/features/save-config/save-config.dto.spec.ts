import { BadRequestException } from '@nestjs/common';
import { SaveBudgetConfigPipe } from './save-config.dto';

const PERCENTAGE_PAYLOAD = {
  monthlyIncome: 100_000,
  allocations: [{ categoryId: 'cat-1', percentageOfIncome: 100 }],
};

describe('SaveBudgetConfigPipe', () => {
  it('rejects an unknown mode', () => {
    expect(() =>
      SaveBudgetConfigPipe.transform({ ...PERCENTAGE_PAYLOAD, mode: 'cycle' }),
    ).toThrow(BadRequestException);
  });

  it('accepts a payload without a mode', () => {
    expect(SaveBudgetConfigPipe.transform(PERCENTAGE_PAYLOAD)).toEqual(
      PERCENTAGE_PAYLOAD,
    );
  });

  it('accepts a fixed payload', () => {
    const payload = {
      mode: 'fixed',
      monthlyIncome: 100_000,
      allocations: [{ categoryId: 'cat-1', targetCents: 100_000 }],
    };

    expect(SaveBudgetConfigPipe.transform(payload)).toEqual(payload);
  });

  it('rejects a target above the safe integer range', () => {
    expect(() =>
      SaveBudgetConfigPipe.transform({
        mode: 'fixed',
        monthlyIncome: 100_000,
        allocations: [
          {
            categoryId: 'cat-1',
            targetCents: Number.MAX_SAFE_INTEGER + 1,
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
});
