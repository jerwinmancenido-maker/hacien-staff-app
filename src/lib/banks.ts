/**
 * Supplier bank helpers.
 *
 * A supplier's receiving bank is THEIR bank, not HACIEN's — suppliers bank
 * with different institutions, so the bank is stored per supplier
 * (`Supplier.bankName`) and picked from this list, with "Other" for
 * foreign / online banks that are not listed.
 *
 * Legacy rows predate the bankName column: their bank was typed into the
 * combined `bankBranch` text as "Bank – Branch". `resolveSupplierBank`
 * reads those rows without rewriting them — an explicit bankName wins;
 * otherwise a leading known bank name followed by a dash is split off.
 * Anything else is left untouched (bank unknown, branch text as stored)
 * rather than guessed.
 */

export const PH_BANKS = [
  "BDO",
  "BPI",
  "Metrobank",
  "Landbank",
  "PNB",
  "RCBC",
  "Security Bank",
  "UnionBank",
  "China Bank",
  "EastWest",
  "AUB",
  "Bank of Commerce",
  "PBCom",
  "PSBank",
  "Maya Bank",
  "GoTyme Bank",
  "Tonik",
  "CIMB Bank",
  "UNO Digital Bank",
] as const;

/** Select value for "the bank is not in the list — type its name". */
export const OTHER_BANK = "Other";

export function isKnownBank(name: string | null | undefined): boolean {
  if (!name) return false;
  const wanted = name.trim().toLowerCase();
  return PH_BANKS.some((b) => b.toLowerCase() === wanted);
}

function canonicalBank(name: string): string | null {
  const wanted = name.trim().toLowerCase();
  return PH_BANKS.find((b) => b.toLowerCase() === wanted) ?? null;
}

const DASH_SPLIT = /\s+[–—-]\s+/;

export function resolveSupplierBank(s: {
  bankName?: string | null;
  bankBranch?: string | null;
}): { bankName: string | null; branch: string | null } {
  const explicit = s.bankName?.trim();
  if (explicit) return { bankName: explicit, branch: s.bankBranch?.trim() || null };

  const raw = s.bankBranch?.trim();
  if (!raw) return { bankName: null, branch: null };

  const whole = canonicalBank(raw);
  if (whole) return { bankName: whole, branch: null };

  const parts = raw.split(DASH_SPLIT);
  if (parts.length > 1) {
    const head = canonicalBank(parts[0]!);
    if (head) return { bankName: head, branch: parts.slice(1).join(" – ").trim() || null };
  }
  return { bankName: null, branch: raw };
}
