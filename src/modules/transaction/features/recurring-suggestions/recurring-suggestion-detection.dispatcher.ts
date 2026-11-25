import { Injectable } from '@nestjs/common';
import { DetectRecurringSuggestionsService } from './detect-recurring-suggestions.service';

@Injectable()
export class RecurringSuggestionDetectionDispatcher {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly rerunRequested = new Set<string>();

  constructor(private readonly detection: DetectRecurringSuggestionsService) {}

  notify(workspaceId: string): void {
    if (this.inFlight.has(workspaceId)) {
      this.rerunRequested.add(workspaceId);
      return;
    }

    this.inFlight.set(workspaceId, this.run(workspaceId));
  }

  private async run(workspaceId: string): Promise<void> {
    try {
      await this.detect(workspaceId);
      while (this.rerunRequested.delete(workspaceId)) {
        await this.detect(workspaceId);
      }
    } finally {
      this.inFlight.delete(workspaceId);
    }
  }

  private async detect(workspaceId: string): Promise<void> {
    await this.detection.execute(workspaceId).catch(() => undefined);
  }
}
