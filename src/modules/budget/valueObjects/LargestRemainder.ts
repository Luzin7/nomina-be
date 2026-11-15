export function distributeTargets(
  monthlyIncome: number,
  percentages: number[],
): number[] {
  if (percentages.length === 0) return [];

  const exactTargets = percentages.map(
    (percentage) => (monthlyIncome * percentage) / 100,
  );
  const targets = exactTargets.map((target) => Math.floor(target));
  const allocated = targets.reduce((total, target) => total + target, 0);
  const remaining = monthlyIncome - allocated;

  const remainderOrder = exactTargets
    .map((target, index) => ({ index, fraction: target - Math.floor(target) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let position = 0; position < remaining; position += 1) {
    targets[remainderOrder[position % remainderOrder.length].index] += 1;
  }

  return targets;
}
