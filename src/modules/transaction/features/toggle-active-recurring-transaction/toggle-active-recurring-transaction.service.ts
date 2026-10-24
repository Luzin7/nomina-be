import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { RecurringTransactionNotFoundError } from '@modules/transaction/errors';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { ToggleActiveRecurringTransactionRequest } from './toggle-active-recurring-transaction.dto';

type Request = ToggleActiveRecurringTransactionRequest &
  Pick<TokenPayloadBase, 'workspaceId'>;

@Injectable()
export class ToggleActiveRecurringTransactionService implements Service<
  Request,
  Error,
  RecurringTransaction
> {
  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly redisService: CacheProvider,
  ) {}

  async execute({
    recurringTransactionId,
    workspaceId,
  }: Request): Promise<Either<Error, RecurringTransaction>> {
    const recurring = await this.recurringRepository.findById(
      recurringTransactionId,
    );

    if (!recurring) {
      return left(new RecurringTransactionNotFoundError());
    }

    if (recurring.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }

    if (recurring.active) {
      recurring.deactivate();
    } else {
      recurring.activate();
    }

    const updated = await this.recurringRepository.update(recurring);

    await this.redisService.delByPattern(`report:*:${workspaceId}:*`);

    return right(updated);
  }
}
