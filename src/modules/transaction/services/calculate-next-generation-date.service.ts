import { RecurrenceFrequency } from '@constants/enums';
import { UnknownRecurrenceFrequencyError } from '@modules/transaction/errors';
import {
  NextGenerationDateCalculator,
  NextGenerationDateRequest,
} from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import { Injectable } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';

@Injectable()
export class CalculateNextGenerationDateService extends NextGenerationDateCalculator {
  constructor(private readonly dateProvider: DateProvider) {
    super();
  }

  execute({
    baseDate,
    frequency,
    interval,
    timezone,
  }: NextGenerationDateRequest): Date {
    switch (frequency) {
      case RecurrenceFrequency.WEEKLY:
        return this.dateProvider.add(baseDate, interval * 7, 'day', timezone);

      case RecurrenceFrequency.MONTHLY:
        return this.dateProvider.add(baseDate, interval, 'month', timezone);

      case RecurrenceFrequency.YEARLY:
        return this.dateProvider.add(baseDate, interval, 'year', timezone);

      default:
        throw new UnknownRecurrenceFrequencyError(String(frequency));
    }
  }
}
