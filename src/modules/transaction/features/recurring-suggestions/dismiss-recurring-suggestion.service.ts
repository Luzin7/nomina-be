import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringSuggestionStatus } from '@constants/enums';
import {
  RecurringSuggestionAlreadyAcceptedError,
  RecurringSuggestionNotFoundError,
} from '@modules/transaction/errors';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadBase, 'workspaceId'> & {
  suggestionId: string;
};

type Response = { id: string; status: 'dismissed' };

@Injectable()
export class DismissRecurringSuggestionService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly suggestionRepository: RecurringSuggestionRepository,
    private readonly cacheProvider: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    suggestionId,
  }: Request): Promise<Either<Error, Response>> {
    const suggestion = await this.suggestionRepository.findByIdForWorkspace({
      suggestionId,
      workspaceId,
    });

    if (!suggestion) return left(new RecurringSuggestionNotFoundError());
    if (suggestion.status === RecurringSuggestionStatus.ACCEPTED) {
      return left(new RecurringSuggestionAlreadyAcceptedError());
    }
    if (suggestion.status === RecurringSuggestionStatus.DISMISSED) {
      return right({ id: suggestion.id, status: 'dismissed' });
    }

    const outcome = await this.suggestionRepository.dismiss({
      suggestionId,
      workspaceId,
    });

    if (outcome.kind === 'not-found') {
      return left(new RecurringSuggestionNotFoundError());
    }
    if (outcome.kind === 'already-accepted') {
      return left(new RecurringSuggestionAlreadyAcceptedError());
    }

    await invalidateLedgerReads(
      this.cacheProvider,
      workspaceId,
      'dismiss-recurring-suggestion',
    );

    return right({ id: suggestion.id, status: 'dismissed' });
  }
}
