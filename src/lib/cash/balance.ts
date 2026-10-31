// Pure scaled-decimal balance math for cash accounts. No floats.
// Running balance = opening + collections − supplier payments − expenses
// ± transfers. Voided rows contribute 0. Date cutoffs use PHT calendar days
// stored as DATE (UTC midnight of that Manila day = YYYY-MM-DD).

import { fromScaled, toScaled } from "../quotes/calc";

export type LedgerDirection = "IN" | "OUT" | "TRANSFER_IN" | "TRANSFER_OUT" | "OPENING";

export type LedgerEntryInput = {
  /** YYYY-MM-DD (Manila calendar day as stored on DATE columns). */
  date: string;
  /** Absolute amount (positive). Direction decides sign. */
  amount: string;
  direction: LedgerDirection;
  /** When true, this entry is ignored in balances. */
  voided?: boolean;
};

/** Compare YYYY-MM-DD strings lexicographically (safe for ISO dates). */
export function ymdCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive window on YYYY-MM-DD. */
export function withinCutoff(dateYmd: string, toYmd?: string | null, fromYmd?: string | null): boolean {
  if (fromYmd && ymdCmp(dateYmd, fromYmd) < 0) return false;
  if (toYmd && ymdCmp(dateYmd, toYmd) > 0) return false;
  return true;
}

export function entrySignedScaled(entry: LedgerEntryInput): bigint {
  if (entry.voided) return 0n;
  const amt = toScaled(entry.amount, 2);
  switch (entry.direction) {
    case "IN":
    case "TRANSFER_IN":
    case "OPENING":
      return amt;
    case "OUT":
    case "TRANSFER_OUT":
      return -amt;
  }
}

/** Absolute account balance as of (optional) Manila date. Voided excluded. */
export function accountBalanceAsOf(
  openingBalance: string,
  openingDate: string,
  entries: readonly LedgerEntryInput[],
  asOfYmd?: string | null,
): string {
  let total = 0n;
  if (!asOfYmd || ymdCmp(openingDate, asOfYmd) <= 0) {
    total += toScaled(openingBalance, 2);
  }
  for (const e of entries) {
    if (e.voided) continue;
    if (asOfYmd && ymdCmp(e.date, asOfYmd) > 0) continue;
    total += entrySignedScaled(e);
  }
  return fromScaled(total, 2);
}

export type LedgerRow = LedgerEntryInput & {
  id: string;
  kind: "COLLECTION" | "SUPPLIER_PAYMENT" | "EXPENSE" | "TRANSFER" | "OPENING";
  number: string;
  description: string;
  href: string | null;
  signedAmount: string;
  runningBalance: string;
};

export type LedgerSourceRow = Omit<LedgerEntryInput, "direction"> & {
  id: string;
  kind: Exclude<LedgerRow["kind"], "OPENING">;
  number: string;
  description: string;
  href: string | null;
  direction: Exclude<LedgerDirection, "OPENING">;
};

/**
 * Build a dated ledger with running balance.
 * Includes a synthetic opening row when openingDate is inside [from, to]
 * (or when there is no from filter).
 */
export function buildLedger(args: {
  openingBalance: string;
  openingDate: string;
  entries: readonly LedgerSourceRow[];
  fromYmd?: string | null;
  toYmd?: string | null;
}): LedgerRow[] {
  const from = args.fromYmd ?? null;
  const to = args.toYmd ?? null;

  // Starting balance just before `from` (so the first visible row continues correctly).
  let running = 0n;
  if (from) {
    running = toScaled(
      accountBalanceAsOf(args.openingBalance, args.openingDate, args.entries, prevYmd(from)),
      2,
    );
  }

  const rows: LedgerRow[] = [];
  const openingInWindow =
    (!from || ymdCmp(args.openingDate, from) >= 0) && (!to || ymdCmp(args.openingDate, to) <= 0);

  if (!from) {
    running = toScaled(args.openingBalance, 2);
    if (openingInWindow) {
      rows.push({
        id: "opening",
        kind: "OPENING",
        number: "—",
        date: args.openingDate,
        amount: args.openingBalance,
        direction: "OPENING",
        description: "Opening balance",
        href: null,
        signedAmount: args.openingBalance,
        runningBalance: fromScaled(running, 2),
        voided: false,
      });
    }
  } else if (openingInWindow) {
    // Opening falls inside the filtered window — add it (it was not in day-before balance
    // if openingDate === from, because prevYmd(from) is before opening).
    if (ymdCmp(args.openingDate, from) === 0) {
      running += toScaled(args.openingBalance, 2);
    }
    rows.push({
      id: "opening",
      kind: "OPENING",
      number: "—",
      date: args.openingDate,
      amount: args.openingBalance,
      direction: "OPENING",
      description: "Opening balance",
      href: null,
      signedAmount: args.openingBalance,
      runningBalance: fromScaled(running, 2),
      voided: false,
    });
  }

  const filtered = args.entries
    .filter((e) => !e.voided && withinCutoff(e.date, to, from))
    .slice()
    .sort((a, b) => {
      const c = ymdCmp(a.date, b.date);
      if (c !== 0) return c;
      return a.number.localeCompare(b.number);
    });

  for (const e of filtered) {
    const signed = entrySignedScaled(e);
    running += signed;
    rows.push({
      ...e,
      signedAmount: fromScaled(signed, 2),
      runningBalance: fromScaled(running, 2),
    });
  }

  return rows;
}

/** Previous calendar day for YYYY-MM-DD (UTC date math; DATE columns are calendar days). */
export function prevYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** CSV escape for ledger export. */
export function ledgerToCsv(rows: readonly LedgerRow[]): string {
  const header = ["Date", "Type", "Number", "Description", "In", "Out", "Balance"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const signed = toScaled(r.signedAmount, 2);
    const inn = signed > 0n ? fromScaled(signed, 2) : "";
    const out = signed < 0n ? fromScaled(-signed, 2) : "";
    const cells = [r.date, r.kind, r.number, r.description, inn, out, r.runningBalance].map(csvCell);
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
