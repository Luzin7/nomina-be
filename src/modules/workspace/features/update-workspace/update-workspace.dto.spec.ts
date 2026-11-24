import { updateWorkspaceBodySchema } from './update-workspace.dto';

describe('UpdateWorkspace body DTO', () => {
  function makeValid(overrides: Record<string, unknown> = {}) {
    return { name: 'My Workspace', ...overrides };
  }

  it('accepts a payload without a cycle', () => {
    expect(updateWorkspaceBodySchema.safeParse(makeValid()).success).toBe(true);
  });

  it.each(['monthly', 'half_month', 'weekly'])(
    'accepts the %s cycle',
    (cycle) => {
      expect(
        updateWorkspaceBodySchema.safeParse(makeValid({ cycle })).success,
      ).toBe(true);
    },
  );

  it.each([
    { reason: 'the name is empty', payload: { name: '' } },
    { reason: 'the cycle is unknown', payload: { cycle: 'daily' } },
    { reason: 'the cycle has the wrong casing', payload: { cycle: 'MONTHLY' } },
    { reason: 'the cycle is not text', payload: { cycle: 30 } },
  ])('rejects when $reason', ({ payload }) => {
    expect(
      updateWorkspaceBodySchema.safeParse(makeValid(payload)).success,
    ).toBe(false);
  });
});
