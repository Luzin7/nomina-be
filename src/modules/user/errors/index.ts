import {
  BusinessRuleDomainError,
  ConflictDomainError,
  NotFoundDomainError,
} from '@shared/core/errors/DomainError';

export class UserNotFoundError extends NotFoundDomainError {
  constructor() {
    super('Usuário não encontrado ou não existe');
  }
}

export class WrongCredentialsError extends BusinessRuleDomainError {
  constructor() {
    super('Email ou senha inválidos');
  }
}

export class UserAlreadyExistsError extends ConflictDomainError {
  constructor() {
    super('Usuário já existe');
  }
}

export class EmailAlreadyInUseError extends ConflictDomainError {
  constructor() {
    super('O email já está em uso por outro usuário');
  }
}

export class InvalidRefreshTokenError extends BusinessRuleDomainError {
  constructor() {
    super('O token de atualização é inválido ou expirou');
  }
}

export class InvalidPasswordError extends BusinessRuleDomainError {
  constructor() {
    super('A senha atual fornecida é inválida');
  }
}

export class PasswordTooWeakError extends BusinessRuleDomainError {
  constructor() {
    super(
      'A nova senha é muito fraca. Ela deve conter pelo menos 8 caracteres, incluindo letras maiúsculas, minúsculas, números e símbolos.',
    );
  }
}

export class InvalidUserAgentError extends BusinessRuleDomainError {
  constructor() {
    super('O agente do usuário é inválido');
  }
}

export class MissingUserIdError extends BusinessRuleDomainError {
  constructor() {
    super('O usuário é obrigatório');
  }
}

export class MissingAuthSessionError extends BusinessRuleDomainError {
  constructor() {
    super('A sessão é obrigatória');
  }
}

export class MissingRefreshTokenHashError extends BusinessRuleDomainError {
  constructor() {
    super('O hash do token é obrigatório');
  }
}

export class InvalidExpirationDateError extends BusinessRuleDomainError {
  constructor() {
    super('A data de expiração é inválida');
  }
}
