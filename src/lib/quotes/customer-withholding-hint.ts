/**
 * Staff-facing rate hint under the customer type on the quote editor / add-customer drawer.
 * Display only — must never invent rates that disagree with defaultWithholdingFor.
 *
 * GOVERNMENT: hide the rate hint (defaults are gov PT 3% WG010; copy is undecided).
 * TWA: Goods 1% WI158 · Services 2% WI160.
 * NONE: no withholding.
 */

export function customerWithholdingHint(type: string): string {
  if (type === "GOVERNMENT") return "";
  if (type === "TOP_WITHHOLDING_AGENT") return "Goods 1% (WI158) · Services 2% (WI160)";
  if (type === "NONE") return "No withholding";
  return "Used on every line for this customer. You can change it per line.";
}
