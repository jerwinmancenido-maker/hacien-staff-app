import type { Settings } from "./schema";

type NumberingFormat = Settings["numbering"]["quote"];

/** Format a document number, e.g. Q-2026-0001. */
export function formatDocNumber(format: NumberingFormat, year: number, counter: number): string {
  return `${format.prefix}-${year}-${String(counter).padStart(format.padding, "0")}`;
}
