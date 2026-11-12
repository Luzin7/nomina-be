import {
  AccountListItem,
  AccountRepository,
} from '@modules/account/repositories/contracts/AccountRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { ListAccountsRequest } from './list-accounts.dto';

type Request = ListAccountsRequest & Pick<TokenPayloadSchema, 'workspaceId'>;
type Response = {
  accounts: AccountListItem[];
  total: number;
};

@Injectable()
export class ListAccountsService implements Service<Request, Error, Response> {
  constructor(private readonly accountRepository: AccountRepository) {}

  async execute({
    page,
    pageSize,
    workspaceId,
  }: Request): Promise<Either<Error, Response>> {
    const { accounts, total } =
      await this.accountRepository.findManyByWorkspaceId(
        workspaceId,
        page,
        pageSize,
      );

    return right({
      accounts,
      total,
    });
  }
}
