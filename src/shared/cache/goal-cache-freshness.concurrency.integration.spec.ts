import { DeleteGoalService } from '@modules/goal/features/delete-goal/delete-goal.service';
import { CreateGoalContributionService } from '@modules/goal/features/create-goal-contribution/create-goal-contribution.service';
import { DeleteGoalContributionService } from '@modules/goal/features/delete-goal-contribution/delete-goal-contribution.service';
import { CreateGoalService } from '@modules/goal/features/create-goal/create-goal.service';
import { UpdateGoalService } from '@modules/goal/features/update-goal/update-goal.service';
import { FRESHNESS_READS } from './test-helpers/freshness-reads';
import {
  FreshnessContext,
  defineFreshnessSuite,
  GOAL_TARGET_CENTS,
  unwrap,
} from './test-helpers/freshness-suite';

const CONTRIBUTION_CENTS = 5_000;

async function contribute({ app, seed }: FreshnessContext): Promise<void> {
  unwrap(
    await app.get(CreateGoalContributionService).execute({
      workspaceId: seed.workspaceId,
      goalId: seed.goalId,
      id: seed.goalId,
      amountCents: CONTRIBUTION_CENTS,
    }),
  );
}

defineFreshnessSuite({
  title: 'goal read cache freshness',
  domain: 'goal',
  reads: FRESHNESS_READS,
  writes: [
    {
      name: 'create-goal-contribution',
      changes: ['list-goals', 'goals-summary', 'goal-contributions'],
      run: contribute,
    },
    {
      name: 'delete-goal-contribution',
      changes: ['list-goals', 'goals-summary', 'goal-contributions'],
      prepare: contribute,
      run: async ({ app, seed }) => {
        unwrap(
          await app.get(DeleteGoalContributionService).execute({
            workspaceId: seed.workspaceId,
            goalId: seed.goalId,
            contributionId: seed.goalId,
          }),
        );
      },
    },
    {
      name: 'create-goal',
      changes: ['list-goals', 'goals-summary'],
      run: async ({ app, seed }) => {
        unwrap(
          await app.get(CreateGoalService).execute({
            workspaceId: seed.workspaceId,
            name: 'Reserva extra',
            targetCents: GOAL_TARGET_CENTS * 2,
          }),
        );
      },
    },
    {
      name: 'update-goal',
      changes: ['list-goals', 'goals-summary'],
      run: async ({ app, seed }) => {
        unwrap(
          await app.get(UpdateGoalService).execute({
            id: seed.goalId,
            workspaceId: seed.workspaceId,
            targetCents: GOAL_TARGET_CENTS * 3,
          }),
        );
      },
    },
    {
      name: 'delete-goal',
      changes: ['list-goals', 'goals-summary'],
      run: async ({ app, seed }) => {
        unwrap(
          await app.get(DeleteGoalService).execute({
            id: seed.goalId,
            workspaceId: seed.workspaceId,
          }),
        );
      },
    },
  ],
});
