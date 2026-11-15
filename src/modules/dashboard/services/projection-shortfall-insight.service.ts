import { GetProjectionService } from '@modules/report/features/get-projection/get-projection.handler';
import { Injectable } from '@nestjs/common';
import type { AvailableToSpendInsight } from '../valueObjects/AvailableToSpend';

export const PROJECTION_INSIGHT_MONTHS = 3;

type Request = { workspaceId: string };

@Injectable()
export class ProjectionShortfallInsightService {
  constructor(private readonly getProjection: GetProjectionService) {}

  async execute({
    workspaceId,
  }: Request): Promise<AvailableToSpendInsight | null> {
    const result = await this.getProjection.execute({
      workspaceId,
      months: PROJECTION_INSIGHT_MONTHS,
    });
    if (result.isLeft()) throw result.value;

    const shortfall = result.value.projection.months.find(
      (month) => month.status !== 'insufficient' && month.shortfallCents > 0,
    );
    if (!shortfall) return null;

    return {
      code: 'PROJECTION_SHORTFALL',
      severity: 'medium',
      args: { monthKey: shortfall.key, amount: shortfall.shortfallCents },
      href: `/projections?month=${shortfall.key}`,
    };
  }
}
