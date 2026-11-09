export function pickApplicableSnapshot<T extends { effectiveFrom: Date }>(
  snapshots: T[],
  monthStart: Date,
): T | null {
  let selected: T | null = null;

  for (const snapshot of snapshots) {
    if (snapshot.effectiveFrom.getTime() > monthStart.getTime()) continue;
    if (
      selected === null ||
      snapshot.effectiveFrom.getTime() > selected.effectiveFrom.getTime()
    ) {
      selected = snapshot;
    }
  }

  return selected;
}
