// Keep non-numeric classifications in their source order after numeric positions.
export function sortPositions<T extends { result: { positionText?: string } }>(rows: T[]): T[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const parse = (s?: string) => s && /^\d+$/.test(s) ? Number(s) : null;
    const left = parse(a.row.result.positionText), right = parse(b.row.result.positionText);
    if (left !== null && right !== null) return left - right || a.index - b.index;
    if (left !== null) return -1;
    if (right !== null) return 1;
    return a.index - b.index;
  }).map(({ row }) => row);
}
