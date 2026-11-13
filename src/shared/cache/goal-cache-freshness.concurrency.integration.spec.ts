import { DeleteGoalService } from '@modules/goal/features/delete-goal/delete-goal.service';
import { CreateGoalService } from '@modules/goal/features/create-goal/create-goal.service';
import { UpdateGoalService } from '@modules/goal/features/update-goal/update-goal.service';
import { FRESHNESS_READS } from './test-helpers/freshness-reads';
import {
  defineFreshnessSuite,
  GOAL_TARGET_CENTS,
  unwrap,
} from './test-helpers/freshness-suite';

defineFreshnessSuite({
  title: 'goal read cache freshness',
  domain: 'goal',
  reads: FRESHNESS_READS,
  writes: [
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
