import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadBase, 'workspaceId'> & { ids: string[] };

type Response = { ids: string[] };

@Injectable()
export class MarkRecurringSuggestionsShownService implements Service<
  Request,
  never,
  Response
> {
  constructor(
    private readonly suggestionRepository: RecurringSuggestionRepository,
    private readonly cacheProvider: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    ids,
  }: Request): Promise<Either<never, Response>> {
    const shownIds = await this.suggestionRepository.markShown(
      workspaceId,
      ids,
    );

    await invalidateLedgerReads(
      this.cacheProvider,
      workspaceId,
      'mark-recurring-suggestions-shown',
    );

    return right({ ids: shownIds });
  }
}
