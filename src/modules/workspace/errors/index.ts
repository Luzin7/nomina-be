import {
  ConflictDomainError,
  GoneDomainError,
  NotFoundDomainError,
} from '@shared/core/errors/DomainError';

export class WorkspaceNotFoundError extends NotFoundDomainError {
  constructor() {
    super('Workspace não encontrado');
  }
}

export class WorkspaceUserNotFoundError extends NotFoundDomainError {
  constructor() {
    super('Usuário do workspace não encontrado');
  }
}

export class InviteNotFoundError extends NotFoundDomainError {
  constructor() {
    super('Código não encontrado. Confira e tente de novo.');
  }
}

export class InviteExpiredError extends GoneDomainError {
  constructor() {
    super('Este convite expirou. Peça um novo código.');
  }
}

export class InviteAlreadyUsedError extends ConflictDomainError {
  constructor() {
    super('Este convite já foi usado. Peça um novo código.');
  }
}

export class ConflictWorkspaceUserError extends ConflictDomainError {
  constructor() {
    super('Você já faz parte deste workspace.');
  }
}

export class ConflictWorkspaceInviteError extends ConflictDomainError {
  constructor() {
    super('Convite já existe para esse usuário e workspace');
  }
}

export class InvalidWorkspaceInviteError extends ConflictDomainError {
  constructor() {
    super('Convite inválido');
  }
}

export class CannotDeleteDefaultWorkspaceError extends ConflictDomainError {
  constructor() {
    super(
      'Não é possível excluir o workspace padrão. Defina outro workspace como padrão antes.',
    );
  }
}
