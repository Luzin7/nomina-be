import { TransactionType } from '@constants/enums';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';

export type AccountListItem = {
  account: AnyAccount;
  balanceUpdatedAt: Date | null;
};

export type AccountLastMovement = {
  accountId: string;
  transactionId: string;
  title: string;
  date: Date;
  amountCents: number;
  type: TransactionType;
};

export type AdjustBalanceInput = {
  id: string;
  accountId: string;
  workspaceId: string;
  actorId: string;
  expectedBalanceCents: number;
  targetBalanceCents: number;
};

export type BalanceAdjustmentRecord = {
  id: string;
  accountId: string;
  expectedBalanceCents: number;
  targetBalanceCents: number;
  deltaCents: number;
  movementSeq: number;
  createdAt: Date;
};

export type AdjustBalanceOutcome =
  | { status: 'account-not-found' }
  | { status: 'key-reused' }
  | { status: 'balance-changed' }
  | { status: 'unchanged' }
  | { status: 'applied'; adjustment: BalanceAdjustmentRecord }
  | { status: 'replayed'; adjustment: BalanceAdjustmentRecord };

export abstract class AccountRepository {
  abstract create(account: AnyAccount): Promise<AnyAccount>;
  abstract createWithOpeningMovement(
    account: AnyAccount,
    actorId: string,
  ): Promise<void>;

  abstract findByNameAndWorkspaceId(
    name: string,
    workspaceId: string,
  ): Promise<AnyAccount | null>;

  abstract findById(accountId: string): Promise<AnyAccount | null>;
  abstract update(account: AnyAccount): Promise<AnyAccount>;
  abstract updateAutoPay(card: CreditCard): Promise<void>;
  abstract delete(accountId: string): Promise<void>;

  abstract adjustBalance(
    input: AdjustBalanceInput,
  ): Promise<AdjustBalanceOutcome>;

  abstract listBalanceAdjustments(
    accountId: string,
    workspaceId: string,
    limit: number,
  ): Promise<BalanceAdjustmentRecord[]>;

  abstract findManyByWorkspaceId(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<{ accounts: AccountListItem[]; total: number }>;

  abstract findAllByWorkspaceId(workspaceId: string): Promise<AnyAccount[]>;

  abstract findLastMovementsByWorkspaceId(
    workspaceId: string,
  ): Promise<AccountLastMovement[]>;

  abstract countByWorkspaceId(workspaceId: string): Promise<number>;
}
