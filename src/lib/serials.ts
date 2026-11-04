// S-48: serial numbers are typed comma- or newline-separated and stored as
// one comma-separated string (null when none). Shared by receiving + delivery.
export function normalizeSerialNumbers(raw: string | null | undefined): string | null {
  const parts = (raw ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
