// Owner-importable .ics for tax deadlines. No calendar API, no email.
// No customer data — only form codes, periods, and due dates.
// Escaping follows RFC 5545 §3.3.11 (TEXT).

import { TAX_CALENDAR_ICS_NAME } from "./calendar-constants";
import type { TaxCalendarRow } from "./calendar-build";

/**
 * Escape a TEXT value per RFC 5545: backslash, semicolon, comma, newline.
 * Also strips CR so only LF (as `\n`) remains inside the value.
 */
export function icsEscapeText(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Fold a content line to ≤75 octets with CRLF + space continuation (RFC 5545). */
export function icsFoldLine(line: string): string {
  // Approximate with UTF-16 length; our payloads are ASCII-heavy.
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

function ymdToIcsDate(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function utcStamp(now: Date): string {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return iso.endsWith("Z") ? iso : `${iso}Z`;
}

export type IcsBuildOptions = {
  /** Calendar NAME / X-WR-CALNAME. */
  name?: string;
  now?: Date;
  /** Product id. */
  prodId?: string;
};

/**
 * Build a VCALENDAR for active dated deadlines.
 * Each event gets VALARM reminders at −7 days and −2 days.
 * Skips undated rows and rows marked Does not apply (greyed) unless included.
 */
export function buildTaxCalendarIcs(
  rows: readonly TaxCalendarRow[],
  opts: IcsBuildOptions = {},
): string {
  const name = opts.name ?? TAX_CALENDAR_ICS_NAME;
  const now = opts.now ?? new Date();
  const prodId = opts.prodId ?? "-//HACIEN Staff//Tax calendar//EN";
  const stamp = utcStamp(now);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscapeText(name)}`,
  ];

  for (const row of rows) {
    if (!row.dueYmd) continue;
    if (row.greyedOut || row.notApplicable) continue;
    if (!row.enabled) continue;

    const summary = `${row.form} — ${row.periodLabel}`;
    const descParts = [row.description, `Period: ${row.periodLabel}`];
    if (row.appliesLabel) descParts.push(`Applies?: ${row.appliesLabel}`);
    if (row.tasks.length) descParts.push(...row.tasks);
    if (row.fileByHint) descParts.push(row.fileByHint);
    descParts.push("Dates follow BIR rules. Check with your accountant if unsure. Not filed by this app.");
    const description = descParts.join("\n");
    const uid = `tax-cal-${row.occurrenceKey.replace(/\|/g, "-")}@hacien.local`;
    const dtStart = ymdToIcsDate(row.dueYmd);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsEscapeText(uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`SUMMARY:${icsEscapeText(summary)}`);
    lines.push(`DESCRIPTION:${icsEscapeText(description)}`);
    // 7-day reminder
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:${icsEscapeText(`${row.form} due in 7 days`)}`);
    lines.push("TRIGGER:-P7D");
    lines.push("END:VALARM");
    // 2-day reminder
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:${icsEscapeText(`${row.form} due in 2 days`)}`);
    lines.push("TRIGGER:-P2D");
    lines.push("END:VALARM");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(icsFoldLine).join("\r\n") + "\r\n";
}
