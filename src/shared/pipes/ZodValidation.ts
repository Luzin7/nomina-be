import { BadRequestException, PipeTransform } from '@nestjs/common';
import { statusCode } from '@shared/core/types/statusCode';
import { ZodError, ZodSchema } from 'zod';
import { fromZodError } from 'zod-validation-error';

/**
 * @class ZodValidationPipe - A validation pipe
 * It will validate the data request on application.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          details: { errors: fromZodError(err) },
          message: 'Dado recebido não pôde ser validado',
          title: 'Validation error',
          status: statusCode.BAD_REQUEST,
        });
      }

      throw new BadRequestException('Dado recebido não pôde ser validado');
    }
  }
}
