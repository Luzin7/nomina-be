import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { ListRecurringTransactionsRequest } from './list-recurring-transactions.dto';

type Request = ListRecurringTransactionsRequest & TokenPayloadBase;

type Response = {
  recurrings: RecurringTransaction[];
  total: number;
};

@Injectable()
export class ListRecurringTransactionsService implements Service<
  Request,
  never,
  Response
> {
  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
  ) {}

  async execute({
    workspaceId,
    page,
    pageSize,
    activeOnly,
    kind,
  }: Request): Promise<Either<never, Response>> {
    const { recurrings, total } =
      await this.recurringRepository.findManyByWorkspaceId({
        workspaceId,
        page,
        pageSize,
        isActive: activeOnly,
        kind,
      });

    return right({ recurrings, total });
  }
}
