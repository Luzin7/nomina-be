import { PLAN_LIMITS, PlanType } from './PlanLimits';

const PLAN_RESOURCES = [
  'maxWorkspaces',
  'maxAccountsPerWorkspace',
  'maxMembersPerWorkspace',
  'maxCategories',
  'maxTransactionsPerMonth',
] as const;

function effectiveLimit(limit: number): number {
  return limit === -1 ? Number.POSITIVE_INFINITY : limit;
}

describe('PLAN_LIMITS', () => {
  it.each(PLAN_RESOURCES)('PRO must not be below TRIAL on %s', (resource) => {
    expect(
      effectiveLimit(PLAN_LIMITS[PlanType.PRO][resource]),
    ).toBeGreaterThanOrEqual(
      effectiveLimit(PLAN_LIMITS[PlanType.TRIAL][resource]),
    );
  });

  it.each(PLAN_RESOURCES)('PRO must not be below FREE on %s', (resource) => {
    expect(
      effectiveLimit(PLAN_LIMITS[PlanType.PRO][resource]),
    ).toBeGreaterThanOrEqual(
      effectiveLimit(PLAN_LIMITS[PlanType.FREE][resource]),
    );
  });

  it.each(PLAN_RESOURCES)(
    'ENTERPRISE must not be below PRO on %s',
    (resource) => {
      expect(
        effectiveLimit(PLAN_LIMITS[PlanType.ENTERPRISE][resource]),
      ).toBeGreaterThanOrEqual(
        effectiveLimit(PLAN_LIMITS[PlanType.PRO][resource]),
      );
    },
  );
});
