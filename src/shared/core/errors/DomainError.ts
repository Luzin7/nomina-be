export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// 404 - Recurso não encontrado
export abstract class NotFoundDomainError extends DomainError {}

// 410 - Recurso existiu mas não está mais disponível (ex: convite expirado)
export abstract class GoneDomainError extends DomainError {}

// 409 - Conflito de estado (ex: e-mail já cadastrado, nome de conta duplicado)
export abstract class ConflictDomainError extends DomainError {}

// 422 - Violação de regra de negócio / Invariante (ex: valor negativo, limite estourado)
export abstract class BusinessRuleDomainError extends DomainError {}

// 400 - Operação inválida de estado (ex: tentar cancelar uma transação já concluída)
export abstract class InvalidOperationDomainError extends DomainError {}

// 403 - Permissão negada (ex: usuário tentando deletar conta de um workspace que não é dono)
export abstract class ForbiddenDomainError extends DomainError {}

// 401 - Falha de credenciais (ex: token inválido, senha incorreta no login)
export abstract class UnauthorizedDomainError extends DomainError {}

// 402 ou 403 - Limite do plano SaaS atingido (ex: plano free só permite 2 contas)
export abstract class PlanLimitExceededDomainError extends DomainError {}
