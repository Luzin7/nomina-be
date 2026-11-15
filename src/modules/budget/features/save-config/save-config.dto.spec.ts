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

  it('defaults a payload without a mode to percentage', () => {
    expect(SaveBudgetConfigPipe.transform(PERCENTAGE_PAYLOAD)).toEqual({
      ...PERCENTAGE_PAYLOAD,
      mode: 'percentage',
    });
  });

  it('accepts mixed-mode fields', () => {
    const payload = {
      mode: 'fixed',
      monthlyIncome: 100_000,
      allocations: [{ categoryId: 'cat-1', percentageOfIncome: 100 }],
    };

    expect(SaveBudgetConfigPipe.transform(payload)).toEqual(payload);
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

  it.each([null, 0, undefined])(
    'rejects a monthly income of %s so a snapshot never gets a null income',
    (monthlyIncome) => {
      expect(() =>
        SaveBudgetConfigPipe.transform({
          ...PERCENTAGE_PAYLOAD,
          monthlyIncome,
        }),
      ).toThrow(BadRequestException);
    },
  );
});
