export enum PlanType {
  TRIAL = 'plan_trial',
  FREE = 'plan_free',
  PRO = 'plan_pro_monthly',
  ENTERPRISE = 'plan_enterprise',
}

export interface PlanLimits {
  maxWorkspaces: number;
  maxAccountsPerWorkspace: number;
  maxMembersPerWorkspace: number;
  maxCategories: number;
  maxTransactionsPerMonth: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  [PlanType.TRIAL]: {
    maxWorkspaces: 5,
    maxAccountsPerWorkspace: 50,
    maxMembersPerWorkspace: 10,
    maxCategories: 0,
    maxTransactionsPerMonth: 25,
  },
  [PlanType.FREE]: {
    maxWorkspaces: 5,
    maxAccountsPerWorkspace: 50,
    maxMembersPerWorkspace: 10,
    maxCategories: 0,
    maxTransactionsPerMonth: 15,
  },
  [PlanType.PRO]: {
    maxWorkspaces: 5,
    maxAccountsPerWorkspace: 100,
    maxMembersPerWorkspace: 25,
    maxCategories: 10,
    maxTransactionsPerMonth: -1,
  },
  [PlanType.ENTERPRISE]: {
    maxWorkspaces: -1,
    maxAccountsPerWorkspace: -1,
    maxMembersPerWorkspace: -1,
    maxCategories: -1,
    maxTransactionsPerMonth: -1,
  },
};

export function getPlanLimits(planId: string): PlanLimits {
  return PLAN_LIMITS[planId] ?? PLAN_LIMITS[PlanType.FREE];
}
