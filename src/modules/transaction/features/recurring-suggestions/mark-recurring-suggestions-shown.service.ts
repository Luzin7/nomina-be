import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
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
  ) {}

  async execute({
    workspaceId,
    ids,
  }: Request): Promise<Either<never, Response>> {
    const shownIds = await this.suggestionRepository.markShown(
      workspaceId,
      ids,
    );

    return right({ ids: shownIds });
  }
}
