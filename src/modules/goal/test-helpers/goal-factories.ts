import { AccountType } from '@constants/enums';
import type { AnyAccount } from '@modules/account/entities/types';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import type { Category } from '@modules/category/entities/Category';
import { CategoryRepository } from '@modules/category/repositories/contracts/CategoryRepository';
import type { GoalRecord } from '@modules/goal/repositories/contracts/GoalRepository';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import {
  GoalContributionRecord,
  GoalContributionRepository,
} from '@modules/goal/repositories/contracts/GoalContributionRepository';

export function makeGoalRecord(
  overrides: Partial<GoalRecord> = {},
): GoalRecord {
  return {
    id: 'goal-1',
    workspaceId: 'ws-1',
    name: 'Viagem',
    targetCents: 0,
    currentCents: 0,
    monthlyAporteCents: 0,
    linkedAccountId: null,
    categoryId: null,
    isEmergency: false,
    isSystem: false,
    dismissedAt: null,
    createdAt: new Date('2026-11-01T12:00:00.000Z'),
    updatedAt: new Date('2026-11-01T12:00:00.000Z'),
    ...overrides,
  };
}

export function makeGoalRepository(): jest.Mocked<GoalRepository> {
  return {
    listByWorkspace: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    findByIdForUpdate: jest.fn(),
    delete: jest.fn(),
    seedEmergencyGoal: jest.fn(),
    sumMonthlyAporteCents: jest.fn(),
    getSummaryAggregates: jest.fn(),
  } as unknown as jest.Mocked<GoalRepository>;
}

export function makeAccountRepository(): jest.Mocked<AccountRepository> {
  return {
    findById: jest.fn(),
  } as unknown as jest.Mocked<AccountRepository>;
}

export function makeCategoryRepository(): jest.Mocked<CategoryRepository> {
  return {
    findById: jest.fn(),
  } as unknown as jest.Mocked<CategoryRepository>;
}

export function makeAccount(
  overrides: { workspaceId?: string; type?: AccountType } = {},
): AnyAccount {
  return {
    workspaceId: overrides.workspaceId ?? 'ws-1',
    type: overrides.type ?? AccountType.CHECKING,
  } as unknown as AnyAccount;
}

export function makeCategory(
  overrides: { workspaceId?: string | null } = {},
): Category {
  return {
    workspaceId: overrides.workspaceId ?? 'ws-1',
  } as unknown as Category;
}

export function makeGoalContributionRecord(
  overrides: Partial<GoalContributionRecord> = {},
): GoalContributionRecord {
  return {
    id: '7f1d1f4e-52a0-4d0c-9a53-1c3f0d6f8a11',
    workspaceId: 'ws-1',
    goalId: 'goal-1',
    amountCents: 5_000,
    sourceAccountId: null,
    contributedAt: new Date('2026-11-10T12:00:00.000Z'),
    createdAt: new Date('2026-11-10T12:00:00.000Z'),
    ...overrides,
  };
}

export function makeGoalContributionRepository(): jest.Mocked<GoalContributionRepository> {
  return {
    recordContribution: jest.fn(),
    undoContribution: jest.fn(),
    listContributionsByGoal: jest.fn(),
  } as unknown as jest.Mocked<GoalContributionRepository>;
}
