import { RecurringSuggestion } from '@modules/transaction/entities/RecurringSuggestion';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import {
  ActiveBillRule,
  BillDetectionTransaction,
  DetectedBillSuggestion,
} from '@modules/transaction/valueObjects/BillSuggestionDetection';

export type RecurringSuggestionView = {
  suggestion: RecurringSuggestion;
  categoryName: string;
  accountName: string;
};

export type BillDetectionState = {
  lastBillDetectionAt: Date | null;
};

export type BillCandidateQuery = {
  workspaceId: string;
  timezone: string;
  from: Date;
  to: Date;
};

export type PersistDetectionInput = {
  workspaceId: string;
  timezone: string;
  now: Date;
  patterns: DetectedBillSuggestion[];
};

export type AcceptSuggestionInput = {
  suggestionId: string;
  workspaceId: string;
  rule: RecurringTransaction;
};

export type AcceptSuggestionOutcome =
  | { kind: 'accepted'; recurringId: string }
  | { kind: 'already-accepted'; recurringId: string | null }
  | { kind: 'dismissed' }
  | { kind: 'not-found' };

export type DismissSuggestionInput = {
  suggestionId: string;
  workspaceId: string;
};

export type DismissSuggestionOutcome =
  | { kind: 'dismissed' }
  | { kind: 'already-accepted' }
  | { kind: 'not-found' };

export type FindSuggestionById = {
  suggestionId: string;
  workspaceId: string;
};

export abstract class RecurringSuggestionRepository {
  abstract findDetectionState(workspaceId: string): Promise<BillDetectionState>;

  abstract findBillCandidates(
    query: BillCandidateQuery,
  ): Promise<BillDetectionTransaction[]>;

  abstract findActiveExpenseRules(
    workspaceId: string,
  ): Promise<ActiveBillRule[]>;

  abstract persistDetection(input: PersistDetectionInput): Promise<void>;

  abstract findPendingByWorkspace(
    workspaceId: string,
  ): Promise<RecurringSuggestionView[]>;

  abstract findByIdForWorkspace({
    suggestionId,
    workspaceId,
  }: FindSuggestionById): Promise<RecurringSuggestion | null>;

  abstract markShown(workspaceId: string, ids: string[]): Promise<string[]>;

  abstract accept(
    input: AcceptSuggestionInput,
  ): Promise<AcceptSuggestionOutcome>;

  abstract dismiss(
    input: DismissSuggestionInput,
  ): Promise<DismissSuggestionOutcome>;
}
