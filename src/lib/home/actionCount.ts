// Home "Needs action" counts come from list views that page at take:200.
// When the list is full, show "200+" so staff know the real total may be higher.

export const HOME_ACTION_COUNT_CAP = 200;

/** Display string for a Home action row count (caps at 200+). */
export function formatHomeActionCount(count: number): string {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= HOME_ACTION_COUNT_CAP) return `${HOME_ACTION_COUNT_CAP}+`;
  return String(Math.trunc(n));
}
