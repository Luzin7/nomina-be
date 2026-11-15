import { BadRequestException } from '@nestjs/common';
import { GetBudgetStatusPipe } from './get-status.dto';

describe('GetBudgetStatusPipe', () => {
  it.each(['2000', '2025', '2026', '2100'])('accepts year %s', (year) => {
    expect(GetBudgetStatusPipe.transform({ month: '12', year })).toEqual({
      month: 12,
      year: Number(year),
    });
  });

  it.each([
    { month: '0', year: '2026' },
    { month: '13', year: '2026' },
    { month: '11', year: '1999' },
    { month: '11', year: '2101' },
    { month: '11' },
    { year: '2026' },
  ])('rejects %j', (query) => {
    expect(() => GetBudgetStatusPipe.transform(query)).toThrow(
      BadRequestException,
    );
  });
});
