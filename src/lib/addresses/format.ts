// Philippine address formatting, shared by the Addresses cards, the print
// documents (customer block) and the Convert-to-SO dialog (delivery address).

export type AddressParts = {
  street: string;
  barangay?: string | null;
  cityMunicipality?: string | null;
  province?: string | null;
  zip?: string | null;
};

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/** "Brgy. San Antonio" — adds the prefix unless the value already says barangay / brgy / bgy. */
export function barangayLabel(barangay: string | null | undefined): string {
  const b = clean(barangay);
  if (!b) return "";
  return /^(brgy|bgy|barangay)\b\.?/i.test(b) ? b : `Brgy. ${b}`;
}

/**
 * One line ("Unit 4, 12 Rizal St., Brgy. San Antonio, Pasig City, Metro Manila 1605")
 * or several lines (street / barangay + city / province + ZIP). Blank parts are skipped.
 * The street keeps its own line breaks in multi-line mode.
 */
export function formatAddress(a: AddressParts, opts: { multiline?: boolean } = {}): string {
  const street = (a.street ?? "").trim();
  const brgy = barangayLabel(a.barangay);
  const city = clean(a.cityMunicipality);
  const provZip = [clean(a.province), clean(a.zip)].filter(Boolean).join(" ");
  if (opts.multiline) {
    const streetLines = street
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);
    return [...streetLines, [brgy, city].filter(Boolean).join(", "), provZip].filter(Boolean).join("\n");
  }
  return [clean(street.replace(/\r?\n/g, ", ")).replace(/,\s*,/g, ","), brgy, city, provZip].filter(Boolean).join(", ");
}
