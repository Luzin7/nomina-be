import { BusinessRuleDomainError } from '@shared/core/errors/DomainError';

export class InsightSourceTimeoutError extends BusinessRuleDomainError {
  constructor(code: string) {
    super(`A fonte do insight ${code} excedeu o tempo limite.`);
  }
}
