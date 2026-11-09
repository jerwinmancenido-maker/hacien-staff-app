import { CompanyLetterhead } from "@/components/docs/CompanyLetterhead";
import { printStripCss } from "@/lib/print/strip-style";
import type { AttachmentSheet } from "@/lib/print/attachment";

/**
 * S-64: packing list & delivery details attachment sheet.
 * Never called a Delivery Receipt or Sales Invoice. The two disclaimer
 * lines are part of the document, not a toolbar note.
 *
 * Print redesign (owner-approved mock v2, 2026-11-09): the sheet uses the
 * same design system as the professional documents — letterhead once in
 * flow, title + DR number block, meta strip, party boxes, the dark items
 * table, a Received by signatory block, the disclaimer box, and the
 * shared footer row. Page 2+ carry the v10 margin-box strip. The
 * policies URL prints once, inside the version line — the old bare-URL
 * line duplicated it (same rule as the professional documents since v8).
 * Received by is a signatory now, not a meta row: the receiver signs
 * this sheet, and when the receipt is already recorded the printed name
 * and the delivery date stand as the signature, like the other prints.
 */
export function PackingListDocument({ sheet }: { sheet: AttachmentSheet }) {
  return (
    <article className="print-page pp-doc-root" aria-label={`Packing list attachment for DR ${sheet.drNumber}`}>
      <style>{printStripCss(`Packing list · ${sheet.drNumber}`.toUpperCase())}</style>
      <header className="pp-head">
        <CompanyLetterhead company={sheet.company} />
      </header>

      <div className="pp-title-block">
        <div>
          <h1>
            <span className="pp-title-pixel" aria-hidden="true" />
            Packing List
          </h1>
          <div className="pp-title-sub">&amp; Delivery Details</div>
        </div>
        <div className="pp-docnum">
          <div className="pp-docnum-label">Attachment to DR No.</div>
          <div className="pp-docnum-value">{sheet.drNumber}</div>
          <div className="pp-docnum-sub">SI No. {sheet.siNumbers}</div>
        </div>
      </div>

      <div className="pp-meta-strip">
        <div className="pp-meta-cell">
          <div className="pp-meta-label">Sales order</div>
          <div className="pp-meta-value">{sheet.salesOrderNumber}</div>
        </div>
        <div className="pp-meta-cell">
          <div className="pp-meta-label">Delivery date</div>
          <div className="pp-meta-value">{sheet.deliveryDate}</div>
        </div>
      </div>

      <section className="pp-party-grid" aria-label="Customer and delivery address">
        <div className="pp-party-box">
          <div className="pp-label">Customer</div>
          <div className="pp-strong">{sheet.customerName}</div>
        </div>
        <div className="pp-party-box">
          <div className="pp-label">Delivery address</div>
          {sheet.customerAddress ? (
            <div className="pp-pre">{sheet.customerAddress}</div>
          ) : (
            <div className="pp-faint">—</div>
          )}
        </div>
      </section>

      <table className="pp-items" aria-label="Packed items">
        <thead>
          <tr>
            <th className="pp-n">#</th>
            <th className="pp-desc">Item</th>
            <th className="num pp-qty">Qty</th>
            <th>Serial numbers</th>
          </tr>
        </thead>
        <tbody>
          {sheet.items.map((item, i) => (
            <tr key={i}>
              <td className="pp-n">{i + 1}</td>
              <td className="pp-desc">
                <div className={item.isLot ? "pp-pre pp-lot-title" : "pp-pre"}>{item.description}</div>
                {item.note ? <div className="pp-item-detail pp-pre">{item.note}</div> : null}
              </td>
              <td className="num pp-qty">{item.qty}</td>
              <td>{item.serials.length ? item.serials.join(", ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {sheet.warrantyNotes ? (
        <section className="pp-notes">
          <div className="pp-note-row">
            <span className="pp-label-inline">Warranty: </span>
            <span className="pp-pre">{sheet.warrantyNotes}</span>
          </div>
        </section>
      ) : null}

      {sheet.banks.length ? (
        <section className="pp-pay" aria-label="HACIEN bank details">
          <div className="pp-label">HACIEN bank details</div>
          <ul>
            {sheet.banks.map((b, i) => (
              <li key={i}>
                {b.label} · {b.accountName} · {b.accountPrinted}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="pp-disclaimer">
        <p>ATTACHMENT ONLY — NOT AN OFFICIAL RECEIPT OR SALES INVOICE.</p>
        <p>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</p>
      </div>

      <section className="pp-signatories" aria-label="Signatures">
        <div className="pp-signatory">
          <div className="pp-sign-role">Received by</div>
          <div className="pp-sign-line" aria-hidden="true" />
          <div className="pp-sign-name">{sheet.receivedBy ?? " "}</div>
          <div className="pp-sign-date">Date</div>
          {sheet.receivedBy ? <div className="pp-sign-date">{sheet.deliveryDate}</div> : null}
        </div>
      </section>

      <footer className="pp-foot">
        <div className="pp-foot-left">
          <p className="pp-faint pp-gen-note" style={{ marginTop: 0 }}>
            Computer-generated. Always issued with the manual BIR DR/SI.
          </p>
          <div className="pp-version-line pp-faint">{sheet.versionLine}</div>
        </div>
        <div className="pp-page-num" aria-hidden="true" />
        <div className="pp-qr-wrap">
          <div
            className="pp-qr"
            role="img"
            aria-label="QR code to policies"
            dangerouslySetInnerHTML={{ __html: sheet.qrSvg }}
          />
          <div className="pp-qr-cap">Scan to verify</div>
        </div>
      </footer>
    </article>
  );
}
