import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

type Kind = 'ledger' | 'category' | 'goal';

const SRC_ROOT = resolve(__dirname, '../..');
const MODULES_ROOT = join(SRC_ROOT, 'modules');

const READS: Record<string, { route: string; kinds: Kind[] }> = {
  'report/features/get-month-summary/get-month-summary.service.ts': {
    route: 'report:month-summary',
    kinds: ['ledger'],
  },
  'report/features/get-balance-evolution/get-balance-evolution.handler.ts': {
    route: 'report:balance-evolution',
    kinds: ['ledger'],
  },
  'report/features/get-expenses-by-category/get-expenses-by-category.handler.ts':
    { route: 'report:expenses-by-category', kinds: ['ledger', 'category'] },
  'report/features/get-cash-flow-evolution/cash-flow-evolution.handler.ts': {
    route: 'report:cash-flow-evolution',
    kinds: ['ledger'],
  },
  'report/features/get-projection/get-projection.handler.ts': {
    route: 'projection',
    kinds: ['ledger', 'goal'],
  },
  'budget/features/get-status/get-status.handler.ts': {
    route: 'budget:status',
    kinds: ['ledger', 'category'],
  },
  'dashboard/features/get-available-to-spend/get-available-to-spend.handler.ts':
    {
      route: 'dashboard:available-to-spend',
      kinds: ['ledger', 'goal', 'category'],
    },
  'goal/features/list-goals/list-goals.service.ts': {
    route: 'goal:list',
    kinds: ['ledger', 'goal', 'category'],
  },
  'goal/features/get-goals-summary/get-goals-summary.service.ts': {
    route: 'goal:summary',
    kinds: ['ledger', 'goal', 'category'],
  },
  'account/features/list-accounts/list-accounts.service.ts': {
    route: 'account:list',
    kinds: ['ledger'],
  },
  'card-cycle/features/get-card-cycle-status/get-card-cycle-status.handler.ts':
    { route: 'account:cycle', kinds: ['ledger'] },
  'transaction/features/list-transaction/list-transaction.service.ts': {
    route: 'transaction:list',
    kinds: ['ledger', 'category'],
  },
  'transaction/features/list-transaction-totals/list-transaction-totals.service.ts':
    { route: 'transaction:list-totals', kinds: ['ledger'] },
  'report/features/get-month-pace/get-month-pace.handler.ts': {
    route: 'report:month-pace',
    kinds: ['ledger'],
  },
  'transaction/features/list-recurring-transactions/list-recurring-transactions.service.ts':
    { route: 'recurring:list', kinds: ['ledger', 'category'] },
  'transaction/features/recurring-summary/recurring-summary.service.ts': {
    route: 'recurring:summary',
    kinds: ['ledger'],
  },
  'transaction/features/recurring-suggestions/list-recurring-suggestions.service.ts':
    { route: 'suggestion:list', kinds: ['ledger', 'category'] },
};

const CATEGORY_LIST_READ =
  'category/features/list-categories/list-categories.handler.ts';

const WRITES: Record<string, Kind[]> = {
  'transaction/features/create-transaction/create-transaction.service.ts': [
    'ledger',
  ],
  'transaction/features/update-transaction/update-transaction.service.ts': [
    'ledger',
  ],
  'transaction/features/delete-transaction/delete-transaction.service.ts': [
    'ledger',
  ],
  'transaction/features/set-transaction-status/set-transaction-status.service.ts':
    ['ledger'],
  'transaction/features/create-installment-purchase/create-installment-purchase.service.ts':
    ['ledger'],
  'transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.service.ts':
    ['ledger'],
  'transaction/features/create-recurring-transaction/create-recurring-transaction.service.ts':
    ['ledger'],
  'transaction/features/update-recurring-transaction/update-recurring-transaction.service.ts':
    ['ledger'],
  'transaction/features/delete-recurring-transaction/delete-recurring-transaction.service.ts':
    ['ledger'],
  'transaction/features/toggle-active-recurring-transaction/toggle-active-recurring-transaction.service.ts':
    ['ledger'],
  'transaction/features/recurring-suggestions/accept-recurring-suggestion.service.ts':
    ['ledger'],
  'transaction/features/recurring-suggestions/dismiss-recurring-suggestion.service.ts':
    ['ledger'],
  'transaction/features/recurring-suggestions/mark-recurring-suggestions-shown.service.ts':
    ['ledger'],
  'transaction/jobs/generate-recurring-transactions/generate-recurring-transactions.service.ts':
    ['ledger'],
  'transaction/jobs/settle-card-installments/settle-card-installments.service.ts':
    ['ledger'],
  'account/features/create-account/create-account.service.ts': ['ledger'],
  'account/features/update-account/update-account.service.ts': ['ledger'],
  'account/features/delete-account/delete-account.handler.ts': ['ledger'],
  'account/features/set-autopay/set-autopay.service.ts': ['ledger'],
  'budget/features/save-config/save-config.handler.ts': ['ledger'],
  'card-cycle/features/save-card-cycle-budget/save-card-cycle-budget.handler.ts':
    ['ledger'],
  'category/features/create-category/create-category.handler.ts': ['category'],
  'category/features/update-category/update-category.handler.ts': [
    'category',
    'ledger',
  ],
  'category/features/delete-category/delete-category.handler.ts': ['category'],
  'goal/features/create-goal/create-goal.service.ts': ['goal'],
  'goal/features/update-goal/update-goal.service.ts': ['goal'],
  'goal/features/delete-goal/delete-goal.service.ts': ['goal'],
};

const INVALIDATORS: Record<string, Kind> = {
  invalidateLedgerReads: 'ledger',
  invalidateCategoryReads: 'category',
  invalidateGoalReads: 'goal',
};

const GENERATION_READERS: Record<string, Kind> = {
  readLedgerGeneration: 'ledger',
  readCategoryGeneration: 'category',
  readGoalGeneration: 'goal',
};

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFilesUnder(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

const MODULE_FILES = sourceFilesUnder(MODULES_ROOT).map((path) => ({
  key: relative(MODULES_ROOT, path),
  source: readFileSync(path, 'utf8'),
}));

function kindsInvoked(source: string, names: Record<string, Kind>): Kind[] {
  const kinds = Object.entries(names)
    .filter(([name]) => new RegExp(`\\b${name}\\(`).test(source))
    .map(([, kind]) => kind);
  return kinds.sort();
}

const scannedWrites = MODULE_FILES.filter(
  ({ source }) => kindsInvoked(source, INVALIDATORS).length > 0,
);
const scannedReads = MODULE_FILES.filter(({ source }) =>
  /\breadThrough[<(]/.test(source),
);

describe('cache invalidation coverage', () => {
  it('lists every file that invalidates a generation', () => {
    expect(scannedWrites.map(({ key }) => key).sort()).toEqual(
      Object.keys(WRITES).sort(),
    );
  });

  it('lists every file that reads through the cache', () => {
    expect(scannedReads.map(({ key }) => key).sort()).toEqual(
      [...Object.keys(READS), CATEGORY_LIST_READ].sort(),
    );
  });

  it.each(Object.entries(WRITES))('%s bumps %j', (file, kinds) => {
    const source = MODULE_FILES.find(({ key }) => key === file)?.source ?? '';

    expect(kindsInvoked(source, INVALIDATORS)).toEqual([...kinds].sort());
  });

  it.each(Object.entries(READS))('%s keys by %j', (file, expected) => {
    const source = MODULE_FILES.find(({ key }) => key === file)?.source ?? '';

    expect(source).toContain(`route: '${expected.route}'`);
    expect(kindsInvoked(source, GENERATION_READERS)).toEqual(
      [...expected.kinds].sort(),
    );
  });

  it('keys the category list by the category generation', () => {
    const source =
      MODULE_FILES.find(({ key }) => key === CATEGORY_LIST_READ)?.source ?? '';

    expect(kindsInvoked(source, GENERATION_READERS)).toEqual(['category']);
  });

  describe.each(Object.entries(READS))('%s', (_readFile, read) => {
    const feeding = Object.entries(WRITES).filter(([, kinds]) =>
      kinds.some((kind) => read.kinds.includes(kind)),
    );

    it.each(feeding.map(([writeFile]) => writeFile))(
      'is invalidated by %s',
      (writeFile) => {
        const source =
          MODULE_FILES.find(({ key }) => key === writeFile)?.source ?? '';
        const bumped = kindsInvoked(source, INVALIDATORS);

        expect(bumped.some((kind) => read.kinds.includes(kind))).toBe(true);
      },
    );
  });
});
