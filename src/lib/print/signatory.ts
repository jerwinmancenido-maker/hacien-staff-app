// Names that appear on signature lines. Never print lab/test accounts.

const BLOCKED_NAMES = [/^qa\s*admin$/i, /^test\s*user$/i, /^test\s*admin$/i];

/** Real person name for print, or null when blank / a blocked test account. */
export function printablePersonName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  if (BLOCKED_NAMES.some((re) => re.test(n))) return null;
  return n;
}

/** Position/title for print; blank when unset. */
export function printablePosition(position: string | null | undefined): string | null {
  const p = (position ?? "").trim();
  return p || null;
}
