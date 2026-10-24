import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringTransactionNotFoundError } from '@modules/transaction/errors';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { DeleteRecurringTransactionRequest } from './delete-recurring-transaction.dto';

type Request = DeleteRecurringTransactionRequest &
  Pick<TokenPayloadBase, 'workspaceId'>;

@Injectable()
export class DeleteRecurringTransactionService implements Service<
  Request,
  Error,
  void
> {
  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly redisService: CacheProvider,
  ) {}

  async execute({
    recurringTransactionId,
    workspaceId,
  }: Request): Promise<Either<Error, void>> {
    const recurring = await this.recurringRepository.findById(
      recurringTransactionId,
    );

    if (!recurring) {
      return left(new RecurringTransactionNotFoundError());
    }

    if (recurring.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }

    await this.recurringRepository.delete(recurringTransactionId);

    await this.redisService.delByPattern(`report:*:${workspaceId}:*`);

    return right(undefined);
  }
}
