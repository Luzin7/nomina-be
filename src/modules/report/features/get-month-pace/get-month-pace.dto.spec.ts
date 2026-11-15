import { BadRequestException } from '@nestjs/common';
import { GetMonthPacePipe } from './get-month-pace.dto';

describe('GetMonthPacePipe', () => {
  it('coerces month and year', () => {
    expect(GetMonthPacePipe.transform({ month: '11', year: '2026' })).toEqual({
      month: 11,
      year: 2026,
    });
  });

  it.each(['2000', '2025', '2100'])('accepts year %s', (year) => {
    expect(GetMonthPacePipe.transform({ month: '11', year })).toEqual({
      month: 11,
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
    expect(() => GetMonthPacePipe.transform(query)).toThrow(
      BadRequestException,
    );
  });
});
