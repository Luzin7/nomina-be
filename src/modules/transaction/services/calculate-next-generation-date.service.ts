import { RecurrenceFrequency } from '@constants/enums';
import { UnknownRecurrenceFrequencyError } from '@modules/transaction/errors';
import {
  NextGenerationDateCalculator,
  NextGenerationDateRequest,
} from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import { Injectable } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { nextOccurrenceAfter } from '@utils/installmentSchedule';

@Injectable()
export class CalculateNextGenerationDateService extends NextGenerationDateCalculator {
  constructor(private readonly dateProvider: DateProvider) {
    super();
  }

  execute({
    anchorDate,
    baseDate,
    frequency,
    interval,
    timezone,
  }: NextGenerationDateRequest): Date {
    if (!Object.values(RecurrenceFrequency).includes(frequency)) {
      throw new UnknownRecurrenceFrequencyError(String(frequency));
    }

    return nextOccurrenceAfter(
      { startDate: anchorDate, frequency, interval, timezone },
      baseDate,
      this.dateProvider,
    );
  }
}
