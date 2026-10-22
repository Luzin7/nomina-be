import { Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common/interfaces/features/arguments-host.interface';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import { Request, Response } from 'express';

const POSTGRES_TIMEOUT_CODES = ['55P03', '57014'];
const MAX_CAUSE_DEPTH = 5;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    this.logCauseChain(exception);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(exception.getResponse());
      return;
    }

    if (this.isPostgresTimeout(exception)) {
      response.status(503).json({
        statusCode: 503,
        message: 'Service temporarily unavailable',
        path: request.url,
      });
      return;
    }

    response.status(500).json({
      statusCode: 500,
      message: 'Internal server error',
      path: request.url,
    });
  }

  private isPostgresTimeout(exception: unknown): boolean {
    let current: unknown = exception;

    for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
      if (!(current instanceof Error)) return false;

      const { code } = current as Error & { code?: unknown };
      if (typeof code === 'string' && POSTGRES_TIMEOUT_CODES.includes(code)) {
        return true;
      }

      current = current.cause;
    }

    return false;
  }

  private logCauseChain(exception: unknown): void {
    let current: unknown = exception;
    let depth = 0;

    while (current instanceof Error && current.cause) {
      depth++;
      const cause = current.cause as unknown;

      if (cause instanceof Error) {
        this.logger.error(
          `[cause depth=${depth}] ${cause.constructor.name}: ${cause.message}`,
          cause.stack,
        );
      } else {
        this.logger.error(`[cause depth=${depth}]`, String(cause));
      }

      current = cause;
    }
  }
}
