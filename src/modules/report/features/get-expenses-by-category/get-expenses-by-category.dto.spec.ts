import { BadRequestException } from '@nestjs/common';
import { GetExpensesByCategoryPipe } from './get-expenses-by-category.dto';

const base = { month: '11', year: '2026' };

describe('GetExpensesByCategoryPipe', () => {
  it('defaults limit to 5 when absent', () => {
    expect(GetExpensesByCategoryPipe.transform(base)).toEqual({
      month: 11,
      year: 2026,
      limit: 5,
    });
  });

  it.each(['2000', '2025', '2100'])('accepts year %s', (year) => {
    expect(GetExpensesByCategoryPipe.transform({ ...base, year })).toEqual(
      expect.objectContaining({ year: Number(year) }),
    );
  });

  it.each(['1999', '2101'])('rejects year %s', (year) => {
    expect(() =>
      GetExpensesByCategoryPipe.transform({ ...base, year }),
    ).toThrow(BadRequestException);
  });

  it.each(['1', '50'])('accepts limit %s', (limit) => {
    expect(GetExpensesByCategoryPipe.transform({ ...base, limit })).toEqual(
      expect.objectContaining({ limit: Number(limit) }),
    );
  });

  it.each(['0', '51', '-1', '2.5', 'abc'])('rejects limit %s', (limit) => {
    expect(() =>
      GetExpensesByCategoryPipe.transform({ ...base, limit }),
    ).toThrow(BadRequestException);
  });
});
