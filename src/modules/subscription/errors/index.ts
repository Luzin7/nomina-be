import {
  BusinessRuleDomainError,
  ForbiddenDomainError,
} from '@shared/core/errors/DomainError';

export class SubscriptionNotActiveError extends ForbiddenDomainError {
  constructor() {
    super('A assinatura do responsável pelo Workspace não está ativa.');
  }
}

export class PlanLimitReachedError extends ForbiddenDomainError {
  constructor(currentCount: number, limit: number) {
    super(
      `Limite de plano atingido (${currentCount}/${limit}). Upgrade necessário para continuar.`,
    );
  }
}

export class WorkspaceMemberLimitReachedError extends ForbiddenDomainError {
  constructor(limit: number) {
    super(`Seu plano permite até ${limit} pessoas por workspace.`);
  }
}

export class WorkspaceOwnerNotFoundError extends BusinessRuleDomainError {
  constructor() {
    super('O Workspace não possui um proprietário válido atrelado.');
  }
}

export class MissingWorkspaceIdError extends BusinessRuleDomainError {
  constructor() {
    super('O ID do Workspace é obrigatório para validação deste recurso.');
  }
}
