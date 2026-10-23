import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BusinessRuleDomainError,
  ConflictDomainError,
  ForbiddenDomainError,
  GoneDomainError,
  NotFoundDomainError,
  UnauthorizedDomainError,
} from '@shared/core/errors/DomainError';

export class ErrorPresenter {
  private static readonly logger = new Logger(ErrorPresenter.name);

  static toHTTP(error: Error): never {
    if (error instanceof NotFoundDomainError) {
      throw new NotFoundException(error.message);
    }

    if (error instanceof GoneDomainError) {
      throw new GoneException(error.message);
    }

    if (error instanceof ConflictDomainError) {
      throw new ConflictException(error.message);
    }

    if (error instanceof BusinessRuleDomainError) {
      throw new UnprocessableEntityException(error.message);
    }

    if (error instanceof UnauthorizedDomainError) {
      throw new UnauthorizedException(error.message);
    }

    if (error instanceof ForbiddenDomainError) {
      throw new ForbiddenException(error.message);
    }

    if (error instanceof HttpException) {
      throw error;
    }

    ErrorPresenter.logger.error('Erro de Servidor/Domínio não tratado:', error);
    throw new InternalServerErrorException('Erro interno do servidor');
  }
}
