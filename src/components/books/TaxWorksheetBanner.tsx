import { TAX_WORKSHEET_BANNER } from "@/lib/tax/constants";

/** Required on every tax worksheet screen — never files, never connects to BIR. */
export function TaxWorksheetBanner() {
  return (
    <div className="alert warn" role="status" style={{ marginBottom: 16 }}>
      <b>{TAX_WORKSHEET_BANNER}</b>
    </div>
  );
}
