/**
 * Shared CSV cell escape for Books, Cash ledger, and tax worksheet exports.
 * Neutralizes spreadsheet formula injection by prefixing a leading apostrophe
 * when the value starts with = + @ tab CR, or a leading minus that is *not* a
 * plain number, then applies normal RFC-style quoting for comma / quote / newline.
 *
 * Plain numeric cells matching /^-?\d+(\.\d+)?$/ (including negatives like
 * "-500.00") stay unescaped so spreadsheet apps keep them as numbers.
 * Risky minus forms ("-cmd", "-1+1") still get the apostrophe.
 */
export function csvCell(v: string): string {
  let out = v;
  const plainNumber = /^-?\d+(\.\d+)?$/.test(out);
  if (/^[=+@\t\r]/.test(out) || (/^-/.test(out) && !plainNumber)) {
    out = `'${out}`;
  }
  if (/[",\n]/.test(out)) return `"${out.replace(/"/g, '""')}"`;
  return out;
}
