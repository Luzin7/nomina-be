import { AnyAccount } from '@modules/account/entities/types';

export abstract class AccountRepository {
  abstract create(account: AnyAccount): Promise<AnyAccount>;
  abstract createWithOpeningMovement(
    account: AnyAccount,
    actorId?: string,
  ): Promise<void>;

  abstract findByNameAndWorkspaceId(
    name: string,
    workspaceId: string,
  ): Promise<AnyAccount | null>;

  abstract findById(accountId: string): Promise<AnyAccount | null>;
  abstract update(account: AnyAccount): Promise<AnyAccount>;
  abstract delete(accountId: string): Promise<void>;

  abstract findManyByWorkspaceId(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<{ accounts: AnyAccount[]; total: number }>;

  abstract findAllByWorkspaceId(workspaceId: string): Promise<AnyAccount[]>;

  abstract countByWorkspaceId(workspaceId: string): Promise<number>;
}
