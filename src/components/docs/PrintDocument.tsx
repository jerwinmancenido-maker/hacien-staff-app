// Customer-facing A4 document (quotation / sales order), rendered on the server
// and saved as PDF from the browser's print dialog. By design it shows NO
// supplier costs, margins or withholding breakdown, and has no signature lines.

import type { PrintDoc } from "@/lib/quotes/views";
import { formatDate, formatPeso } from "@/lib/format";
import { TERMS_URL } from "@/lib/print/qr";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");
const qty = (q: string) => q.replace(/\.00$/, "");

export function PrintDocument({ doc, qrSvg }: { doc: PrintDoc; qrSvg: string }) {
  return (
    <article className="print-page" aria-label={`${doc.title} ${doc.number}`}>
      <header className="print-head">
        <div>
          <div className="print-company">{doc.company.name}</div>
          <div className="print-nonvat">NON-VAT</div>
          {doc.company.tin && <div>TIN {doc.company.tin}</div>}
          {doc.company.address && <div className="print-pre">{doc.company.address}</div>}
        </div>
        <div className="print-title">
          <h1>{doc.title}</h1>
          <table className="print-meta">
            <tbody>
              <tr>
                <th>{doc.title === "Quotation" ? "Quotation no." : "SO no."}</th>
                <td>{doc.number}</td>
              </tr>
              <tr>
                <th>Date</th>
                <td>{day(doc.date)}</td>
              </tr>
              {doc.validUntil && (
                <tr>
                  <th>Valid until</th>
                  <td>{day(doc.validUntil)}</td>
                </tr>
              )}
              {doc.buyerPoNo && (
                <tr>
                  <th>Buyer PO no.</th>
                  <td>{doc.buyerPoNo}</td>
                </tr>
              )}
              {doc.buyerPoDate && (
                <tr>
                  <th>Buyer PO date</th>
                  <td>{day(doc.buyerPoDate)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {doc.status === "VOID" && <div className="print-void">VOID</div>}
        </div>
      </header>

      <section className="print-parties">
        <div>
          <div className="print-label">Customer</div>
          <div className="strong">{doc.customer.name}</div>
          {doc.customer.tin && <div>TIN {doc.customer.tin}</div>}
          {doc.customer.address && <div className="print-pre">{doc.customer.address}</div>}
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
        {doc.deliveryAddress && (
          <div>
            <div className="print-label">Deliver to</div>
            <div className="print-pre">{doc.deliveryAddress}</div>
          </div>
        )}
      </section>

      <table className="print-items">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th>Unit</th>
            <th className="num">Unit price</th>
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
              <td className="num">{formatPeso(i.unitPrice)}</td>
              <td className="num">{formatPeso(i.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={5} className="num">
              Contract price
            </th>
            <th className="num">{formatPeso(doc.contractPrice)}</th>
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
