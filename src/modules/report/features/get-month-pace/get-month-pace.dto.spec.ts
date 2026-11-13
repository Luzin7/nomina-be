import { BadRequestException } from '@nestjs/common';
import { GetMonthPacePipe } from './get-month-pace.dto';

describe('GetMonthPacePipe', () => {
  it('coerces month and year', () => {
    expect(GetMonthPacePipe.transform({ month: '11', year: '2026' })).toEqual({
      month: 11,
      year: 2026,
    });
  });

  it.each([
    { month: '0', year: '2026' },
    { month: '13', year: '2026' },
    { month: '11', year: '2025' },
    { month: '11' },
    { year: '2026' },
  ])('rejects %j', (query) => {
    expect(() => GetMonthPacePipe.transform(query)).toThrow(
      BadRequestException,
    );
  });
});
