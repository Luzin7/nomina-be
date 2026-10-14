import { RecurrenceFrequency } from '@constants/enums';

export interface NextGenerationDateRequest {
  baseDate: Date;
  frequency: RecurrenceFrequency;
  interval: number;
  timezone: string;
}

export abstract class NextGenerationDateCalculator {
  abstract execute(request: NextGenerationDateRequest): Date;
}
