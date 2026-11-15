export class MissingCardCyclePeriodError extends Error {
  constructor(input: {
    workspaceId: string;
    accountId: string;
    dueDate: string;
  }) {
    super(
      `card_cycle_periods row for workspace "${input.workspaceId}", account "${input.accountId}" and due date "${input.dueDate}" is missing after materialization`,
    );
    this.name = 'MissingCardCyclePeriodError';
  }
}
