/** Comma-separated table numbers; leading zeroes are only visual formatting. */
export function matchesTableNumberFilter(tableNumber: number | string | null | undefined, filter: string): boolean {
  const values = filter.split(/[,;\s]+/).filter(Boolean);
  if (!values.length) return true;
  if (!values.every((value) => /^\d+$/.test(value))) return false;
  const current = Number(tableNumber);
  return Number.isInteger(current) && current > 0 && values.some((value) => Number(value) === current);
}
