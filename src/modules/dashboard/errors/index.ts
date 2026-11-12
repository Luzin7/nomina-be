import { BusinessRuleDomainError } from '@shared/core/errors/DomainError';

export class InsightSourceTimeoutError extends BusinessRuleDomainError {
  constructor(code: string) {
    super(`A fonte do insight ${code} excedeu o tempo limite.`);
  }
}

export class AccountScanTruncatedError extends BusinessRuleDomainError {
  constructor() {
    super('A lista de contas excede a página lida para avaliar faturas.');
  }
}
