import { CompanyLetterhead } from "@/components/docs/CompanyLetterhead";
import { PrintHeaderRepeat } from "@/components/docs/PrintHeaderRepeat";
import type { AttachmentSheet } from "@/lib/print/attachment";

/**
 * S-64: packing list & delivery details attachment sheet.
 * Never called a Delivery Receipt or Sales Invoice. The two disclaimer
 * lines are part of the document, not a toolbar note.
 */
export function PackingListDocument({ sheet }: { sheet: AttachmentSheet }) {
  return (
    <article className="print-page" aria-label={`Packing list attachment for DR ${sheet.drNumber}`}>
      <PrintHeaderRepeat header={<CompanyLetterhead company={sheet.company} />}>
      <div className="print-title" style={{ textAlign: "center", margin: "16px 0" }}>
        <h1>PACKING LIST &amp; DELIVERY DETAILS</h1>
        <div>
          (Attachment to DR No. {sheet.drNumber} / SI No. {sheet.siNumbers})
        </div>
      </div>
      <table className="print-meta">
        <tbody>
          <tr>
            <th>Sales order</th>
            <td>{sheet.salesOrderNumber}</td>
          </tr>
          <tr>
            <th>Customer</th>
            <td>{sheet.customerName}</td>
          </tr>
          {sheet.customerAddress ? (
            <tr>
              <th>Delivery address</th>
              <td>{sheet.customerAddress}</td>
            </tr>
          ) : null}
          <tr>
            <th>Delivery date</th>
            <td>{sheet.deliveryDate}</td>
          </tr>
          {sheet.receivedBy ? (
            <tr>
              <th>Received by</th>
              <td>{sheet.receivedBy}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <table className="list" aria-label="Packed items">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th>Serial numbers</th>
          </tr>
        </thead>
        <tbody>
          {sheet.items.map((item, i) => (
            <tr key={i}>
              <td>
                {item.description}
                {item.note ? <div className="small faint">{item.note}</div> : null}
              </td>
              <td className="num">{item.qty}</td>
              <td>{item.serials.length ? item.serials.join(", ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.warrantyNotes ? (
        <div style={{ marginTop: 16 }}>
          <div className="label">Warranty</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{sheet.warrantyNotes}</div>
        </div>
      ) : null}
      {sheet.banks.length ? (
        <div style={{ marginTop: 16 }}>
          <div className="label">HACIEN bank details</div>
          {sheet.banks.map((b, i) => (
            <div key={i}>
              {b.label} · {b.accountName} · {b.accountPrinted}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ marginTop: 24, fontWeight: 700 }}>
        <p>ATTACHMENT ONLY — NOT AN OFFICIAL RECEIPT OR SALES INVOICE.</p>
        <p>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</p>
      </div>
      <div style={{ marginTop: 16 }}>
        <p className="small faint">Computer-generated. Always issued with the manual BIR DR/SI.</p>
        <div
          dangerouslySetInnerHTML={{ __html: sheet.qrSvg }}
          role="img"
          aria-label="QR code to policies"
          style={{ width: 96, height: 96 }}
        />
        <div>{sheet.policiesUrl}</div>
        <div>{sheet.versionLine}</div>
      </div>
      </PrintHeaderRepeat>
    </article>
  );
}
