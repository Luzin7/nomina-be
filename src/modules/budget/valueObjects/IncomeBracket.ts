export const GROUP_KEYS = ['essentials', 'lifestyle', 'savings'] as const;

export type GroupKey = (typeof GROUP_KEYS)[number];

export type IncomeBracketRow = {
  position: number;
  maxMinimumWages: string | null;
  essentialsBp: number;
  lifestyleBp: number;
  savingsBp: number;
};

export type ResolvedBracket = {
  position: number;
  shares: Record<GroupKey, number>;
};

type ResolveIncomeBracketInput = {
  incomeCents: number;
  minimumWageCents: number;
  rows: IncomeBracketRow[];
};

const HUNDREDTHS = 100;

const ceilingHundredths = (row: IncomeBracketRow): number =>
  Math.round(Number(row.maxMinimumWages) * HUNDREDTHS);

const hasValidLadder = (rows: IncomeBracketRow[]): boolean => {
  if (rows.length === 0) return false;

  return rows.every((row, index) => {
    if (row.position !== index + 1) return false;
    if (index === rows.length - 1) return row.maxMinimumWages === null;
    if (row.maxMinimumWages === null) return false;

    return (
      index === 0 || ceilingHundredths(row) > ceilingHundredths(rows[index - 1])
    );
  });
};

const fitsRow = (
  row: IncomeBracketRow,
  incomeCents: number,
  minimumWageCents: number,
): boolean =>
  row.maxMinimumWages === null ||
  incomeCents * HUNDREDTHS <= ceilingHundredths(row) * minimumWageCents;

export function resolveIncomeBracket({
  incomeCents,
  minimumWageCents,
  rows,
}: ResolveIncomeBracketInput): ResolvedBracket | null {
  if (minimumWageCents <= 0) return null;

  const ladder = [...rows].sort((a, b) => a.position - b.position);
  if (!hasValidLadder(ladder)) return null;

  const row = ladder.find((candidate) =>
    fitsRow(candidate, incomeCents, minimumWageCents),
  );
  if (!row) return null;

  return {
    position: row.position,
    shares: {
      essentials: row.essentialsBp,
      lifestyle: row.lifestyleBp,
      savings: row.savingsBp,
    },
  };
}
