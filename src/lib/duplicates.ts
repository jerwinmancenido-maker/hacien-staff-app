/**
 * Near-duplicate name warning for master records (finding 1364).
 *
 * ONE shared mechanism for customers, suppliers and items: before a create,
 * the new name is compared against every existing name of the same kind on
 * NORMALISED forms (case / punctuation / spacing / diacritic-insensitive),
 * with a small edit-distance and a token-subset rule on top, so a one-letter
 * typo ("Juan Dela Cruz Tradng", "Metro IT Part") and an exact repeat both
 * warn. It is a warning, never a hard block — legitimate near-names exist —
 * and saving past it is an explicit confirm that the create's AuditLog row
 * records (duplicateNameWarningConfirmed).
 */
import type { Db, Tx } from "./db";

export type MasterKind = "customer" | "supplier" | "item";

export interface NameMatch {
  id: string;
  name: string;
  active: boolean;
}

/** Case / punctuation / spacing / diacritic-insensitive name normalisation. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance; exact for the short strings names are. */
export function nameEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 10) return Math.abs(m - n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = cur;
  }
  return prev[n]!;
}

/**
 * Near-match: both names are normalised first (normalising an already
 * normalised name is a no-op), then compared — equal, within a small edit
 * distance (1 edit for short names, 2 for names of 10+ chars), or one
 * name's words all contained in the other's with at most two extra words
 * ("X Trading" vs "X Trading Inc").
 */
export function isNearName(aRaw: string, bRaw: string): boolean {
  const aNorm = normalizeName(aRaw);
  const bNorm = normalizeName(bRaw);
  if (!aNorm || !bNorm) return false;
  if (aNorm === bNorm) return true;
  const at = aNorm.split(" ");
  const bt = bNorm.split(" ");
  const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
  if (short.length >= 2 && long.length - short.length <= 2) {
    const longSet = new Set(long);
    if (short.every((t) => longSet.has(t))) return true;
  }
  if (Math.abs(aNorm.length - bNorm.length) > 2) return false;
  const limit = Math.min(aNorm.length, bNorm.length) >= 10 ? 2 : 1;
  return nameEditDistance(aNorm, bNorm) <= limit;
}

/** Near matches for `name` among candidate rows, best first, capped at 5. */
export function findNearNameMatches(
  candidates: readonly NameMatch[],
  name: string,
  excludeId?: string | null,
): NameMatch[] {
  const target = normalizeName(name);
  if (!target) return [];
  const scored: { row: NameMatch; exact: boolean; dist: number }[] = [];
  for (const row of candidates) {
    if (excludeId && row.id === excludeId) continue;
    const cn = normalizeName(row.name);
    if (!isNearName(target, cn)) continue;
    scored.push({ row, exact: cn === target, dist: cn === target ? 0 : nameEditDistance(target, cn) });
  }
  scored.sort((x, y) => Number(y.exact) - Number(x.exact) || x.dist - y.dist || x.row.name.localeCompare(y.row.name));
  return scored.slice(0, 5).map((s) => s.row);
}

type NameDelegate = {
  findMany: (args: { select: { id: true; name: true; active: true } }) => Promise<NameMatch[]>;
};
type NameClient = { customer: NameDelegate; supplier: NameDelegate; item: NameDelegate };

/**
 * Near-duplicate lookup against the live records of one kind. Accepts the
 * root client or a transaction client — master lists are small, so the
 * comparison runs in memory on normalised forms.
 */
export async function findDuplicateNames(
  client: Db | Tx,
  kind: MasterKind,
  name: string,
  excludeId?: string | null,
): Promise<NameMatch[]> {
  const delegate = (client as NameClient)[kind];
  const rows = await delegate.findMany({ select: { id: true, name: true, active: true } });
  return findNearNameMatches(rows, name, excludeId);
}

const KIND_LABEL: Record<MasterKind, { one: string; plural: string }> = {
  customer: { one: "customer", plural: "Customers" },
  supplier: { one: "supplier", plural: "Suppliers" },
  item: { one: "product", plural: "Products" },
};

/** The warning text; names the existing record(s). Single-match shape is the
 * long-standing customer-form wording (F38). */
export function duplicateWarningMessage(kind: MasterKind, matches: readonly NameMatch[]): string {
  const label = KIND_LABEL[kind];
  if (matches.length === 1) {
    const m = matches[0]!;
    return `A ${label.one} named "${m.name}" already exists${m.active ? "" : " (inactive)"}. If this is a different ${label.one}, save anyway.`;
  }
  const list = matches.map((m) => `"${m.name}"${m.active ? "" : " (inactive)"}`).join(", ");
  return `${label.plural} with similar names already exist: ${list}. If this is a different ${label.one}, save anyway.`;
}

/** The AuditLog note recorded when a create proceeds past the warning. */
export function duplicateConfirmNote(matches: readonly NameMatch[]): { id: string; name: string }[] | null {
  return matches.length ? matches.map((m) => ({ id: m.id, name: m.name })) : null;
}
