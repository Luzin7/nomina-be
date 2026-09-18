import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { DeleteAccountRequest } from './delete-account.dto';

type Request = DeleteAccountRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class DeleteAccountService implements Service<Request, Error, void> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly redisService: CacheProvider,
  ) {}

  async execute({
    accountId,
    workspaceId,
  }: Request): Promise<Either<Error, void>> {
    const account = await this.accountRepository.findById(accountId);

    if (account?.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }

    await this.accountRepository.delete(accountId);
    await this.redisService.delByPattern(`report:*:${workspaceId}:*`);

    return right(undefined);
  }
}
