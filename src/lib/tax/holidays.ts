// Philippine holiday list for tax due-date rolling (RMC 65-2016).
// Editable in Settings → Tax year. Seeded for 2026; owner may add/remove.

export type HolidayKind = "regular" | "special";

export type TaxHoliday = {
  /** YYYY-MM-DD (Manila calendar day). */
  ymd: string;
  kind: HolidayKind;
  /** Optional plain label for the settings UI. */
  name?: string;
};

/** 2026 PH holidays confirmed for the seed (regular + special non-working). */
export const PH_HOLIDAYS_2026: readonly TaxHoliday[] = [
  // Regular holidays
  { ymd: "2026-01-01", kind: "regular", name: "New Year's Day" },
  { ymd: "2026-03-20", kind: "regular", name: "Eid'l Fitr" },
  { ymd: "2026-04-02", kind: "regular", name: "Maundy Thursday" },
  { ymd: "2026-04-03", kind: "regular", name: "Good Friday" },
  { ymd: "2026-04-09", kind: "regular", name: "Araw ng Kagitingan" },
  { ymd: "2026-05-01", kind: "regular", name: "Labor Day" },
  { ymd: "2026-05-27", kind: "regular", name: "Eid'l Adha" },
  { ymd: "2026-06-12", kind: "regular", name: "Independence Day" },
  { ymd: "2026-08-31", kind: "regular", name: "National Heroes Day" },
  { ymd: "2026-11-30", kind: "regular", name: "Bonifacio Day" },
  { ymd: "2026-12-25", kind: "regular", name: "Christmas Day" },
  { ymd: "2026-12-30", kind: "regular", name: "Rizal Day" },
  // Special non-working holidays
  { ymd: "2026-02-17", kind: "special", name: "Chinese New Year" },
  { ymd: "2026-04-04", kind: "special", name: "Black Saturday" },
  { ymd: "2026-08-21", kind: "special", name: "Ninoy Aquino Day" },
  { ymd: "2026-11-01", kind: "special", name: "All Saints' Day" },
  { ymd: "2026-11-02", kind: "special", name: "All Souls' Day" },
  { ymd: "2026-12-08", kind: "special", name: "Feast of the Immaculate Conception" },
  { ymd: "2026-12-24", kind: "special", name: "Christmas Eve" },
  { ymd: "2026-12-31", kind: "special", name: "New Year's Eve" },
] as const;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize / validate a holiday list (drop blanks, dedupe by ymd). */
export function normalizeHolidays(input: readonly TaxHoliday[]): TaxHoliday[] {
  const seen = new Set<string>();
  const out: TaxHoliday[] = [];
  for (const h of input) {
    const ymd = (h.ymd ?? "").trim();
    if (!YMD_RE.test(ymd)) continue;
    if (seen.has(ymd)) continue;
    seen.add(ymd);
    const kind: HolidayKind = h.kind === "special" ? "special" : "regular";
    const name = h.name?.trim() || undefined;
    out.push(name ? { ymd, kind, name } : { ymd, kind });
  }
  out.sort((a, b) => a.ymd.localeCompare(b.ymd));
  return out;
}

/** Set of holiday YMD strings for fast lookup. */
export function holidayYmdSet(
  holidays: readonly TaxHoliday[] | ReadonlySet<string>,
): Set<string> {
  if (holidays instanceof Set) return new Set(holidays);
  return new Set((holidays as readonly TaxHoliday[]).map((h) => h.ymd));
}

/**
 * Parse Settings → Tax year holiday lines.
 * Accepted lines:
 *   2026-01-01
 *   2026-01-01 regular
 *   2026-02-17 special Chinese New Year
 * Blank lines and `#` comments ignored.
 */
export function parseHolidayLines(text: string): TaxHoliday[] {
  const rows: TaxHoliday[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const ymd = parts[0] ?? "";
    if (!YMD_RE.test(ymd)) continue;
    let kind: HolidayKind = "regular";
    let nameParts: string[] = [];
    if (parts[1] === "regular" || parts[1] === "special") {
      kind = parts[1];
      nameParts = parts.slice(2);
    } else if (parts.length > 1) {
      nameParts = parts.slice(1);
    }
    const name = nameParts.join(" ").trim() || undefined;
    rows.push(name ? { ymd, kind, name } : { ymd, kind });
  }
  return normalizeHolidays(rows);
}

/** Serialize holidays for the Settings lines textarea. */
export function formatHolidayLines(holidays: readonly TaxHoliday[]): string {
  return normalizeHolidays(holidays)
    .map((h) => {
      const base = `${h.ymd} ${h.kind}`;
      return h.name ? `${base} ${h.name}` : base;
    })
    .join("\n");
}
