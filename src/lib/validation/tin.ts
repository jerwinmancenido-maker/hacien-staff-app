// Philippine TIN: 9 digits plus a branch code (3 digits, or 5 for newer branch codes).
// Stored as 000-000-000-000. A TIN typed without a branch code is the head office (000).

const TIN_PATTERN = /^(\d{3})-?(\d{3})-?(\d{3})(?:-?(\d{3}|\d{5}))?$/;

/** Returns the normalized TIN, null for empty input, or "invalid". */
export function normalizeTin(input: string | null | undefined): string | null | "invalid" {
  const raw = (input ?? "").trim().replace(/\s+/g, "");
  if (!raw) return null;
  const m = TIN_PATTERN.exec(raw);
  if (!m) return "invalid";
  return `${m[1]}-${m[2]}-${m[3]}-${m[4] ?? "000"}`;
}

export const TIN_FORMAT_MESSAGE = "Use the format 000-000-000-000 (branch code optional).";
