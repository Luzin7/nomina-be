import { NotFoundDomainError } from '@shared/core/errors/DomainError';

export class SpendableWorkspaceNotFoundError extends NotFoundDomainError {
  constructor() {
    super('Workspace não encontrado');
  }
}
