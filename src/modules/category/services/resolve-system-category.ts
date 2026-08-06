import { Either, left, right } from '@shared/core/errors/Either';
import { SystemCategoryRef } from '../constants/system-categories';
import { SystemCategoryNotFoundError } from '../errors';
import { CategoryRepository } from '../repositories/contracts/CategoryRepository';

/**
 * Resolve o ID de uma categoria de sistema pelo nome.
 *
 * Compartilhado por todos os fluxos em que o backend atribui a categoria sem
 * perguntar ao usuário (transferência, pagamento de fatura). Se a categoria não
 * existir, falha explicitamente em vez de deixar o insert violar a FK e virar
 * um 500 opaco.
 */
export async function resolveSystemCategoryId(
  categoryRepository: CategoryRepository,
  ref: SystemCategoryRef,
): Promise<Either<Error, string>> {
  const category = await categoryRepository.findSystemCategoryByName(
    ref.name,
    ref.type,
  );

  if (!category) return left(new SystemCategoryNotFoundError(ref.name));

  return right(category.id);
}
