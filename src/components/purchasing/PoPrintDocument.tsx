// Supplier-facing A4 purchase order, rendered on the server and saved as PDF
// from the browser's print dialog. Shows our unit costs (that's what we pay)
// but never customer selling prices, margins or withholding. No signature lines.

import type { PoPrintDoc } from "@/lib/purchasing/views";
import { formatDate, formatPeso } from "@/lib/format";
import { TERMS_URL } from "@/lib/print/qr";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");
const qty = (q: string) => q.replace(/\.00$/, "");

/** Company details missing from Company settings ("TIN", "address"). */
export function missingCompanyDetails(company: PoPrintDoc["company"]): string[] {
  return [!company.tin.trim() && "TIN", !company.address.trim() && "address"].filter((v): v is string => !!v);
}

export function PoPrintDocument({ doc, qrSvg }: { doc: PoPrintDoc; qrSvg: string }) {
  return (
    <article className="print-page" aria-label={`Purchase order ${doc.number}`}>
      <header className="print-head">
        <div>
          <div className="print-company">{doc.company.name}</div>
          <div className="print-nonvat">NON-VAT</div>
          {/* Blank Company settings print a visible placeholder instead of silently omitting the line. */}
          {doc.company.tin.trim() ? <div>TIN {doc.company.tin}</div> : <div className="print-missing">TIN: [not set in Company settings]</div>}
          {doc.company.address.trim() ? (
            <div className="print-pre">{doc.company.address}</div>
          ) : (
            <div className="print-missing">Address: [not set in Company settings]</div>
          )}
        </div>
        <div className="print-title">
          <h1>Purchase Order</h1>
          <table className="print-meta">
            <tbody>
              <tr>
                <th>PO no.</th>
                <td>
                  {doc.number}
                  {doc.revision > 1 ? ` (rev. ${doc.revision})` : ""}
                </td>
              </tr>
              <tr>
                <th>Date</th>
                <td>{day(doc.date)}</td>
              </tr>
              {doc.expectedDate && (
                <tr>
                  <th>Expected delivery</th>
                  <td>{day(doc.expectedDate)}</td>
                </tr>
              )}
              {doc.salesOrderNumber && (
                <tr>
                  <th>Our ref.</th>
                  <td>{doc.salesOrderNumber}</td>
                </tr>
              )}
            </tbody>
          </table>
          {doc.status === "VOID" && <div className="print-void">VOID</div>}
          {doc.status === "DRAFT" && <div className="print-void">DRAFT</div>}
        </div>
      </header>

      <section className="print-parties">
        <div>
          <div className="print-label">Supplier</div>
          <div className="strong">{doc.supplier.name}</div>
          {doc.supplier.tin && <div>TIN {doc.supplier.tin}</div>}
          {doc.supplier.address && <div className="print-pre">{doc.supplier.address}</div>}
        </div>
        <div>
          <div className="print-label">Attention</div>
          {doc.contact ? (
            <>
              <div className="strong">{doc.contact.name}</div>
              {doc.contact.email && <div>{doc.contact.email}</div>}
              {doc.contact.phone && <div>{doc.contact.phone}</div>}
            </>
          ) : (
            <div>—</div>
          )}
        </div>
        <div>
          <div className="print-label">Deliver to</div>
          <div className="print-pre">{doc.deliveryAddress ?? "—"}</div>
        </div>
      </section>

      <table className="print-items">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th>Unit</th>
            <th className="num">Unit cost</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((i, n) => (
            <tr key={n}>
              <td>{n + 1}</td>
              <td className="print-pre">{i.description}</td>
              <td className="num">{qty(i.qty)}</td>
              <td>{i.unit}</td>
              <td className="num">{formatPeso(i.unitCost)}</td>
              <td className="num">{formatPeso(i.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={5} className="num">
              Total
            </th>
            <th className="num">{formatPeso(doc.subtotal)}</th>
          </tr>
        </tfoot>
      </table>

      <section className="print-terms">
        <div>
          <span className="print-label">Terms: </span>
          {doc.terms ?? "—"}
        </div>
        {doc.notes && <div className="print-pre">{doc.notes}</div>}
      </section>

      <footer className="print-foot">
        <div>
          <div>This is a system-generated document. No signature required.</div>
          <div className="faint">Terms and conditions: {TERMS_URL}</div>
        </div>
        <div className="print-qr" role="img" aria-label={`QR code to ${TERMS_URL}`} dangerouslySetInnerHTML={{ __html: qrSvg }} />
      </footer>
    </article>
  );
}
