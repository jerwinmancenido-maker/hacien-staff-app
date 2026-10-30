// Shared professional A4/Letter print layout for every printable document.
// Customer docs must never show supplier costs/margins; supplier docs must never
// show customer selling prices. Tax wording comes only from lib/print/tax-wording.

import { formatPeso } from "@/lib/format";
import { NON_VAT_LABEL } from "@/lib/print/tax-wording";
import type { ProfessionalPrintModel } from "@/lib/print/types";

const qty = (q: string) => q.replace(/\.00$/, "");

function CompanyLetterhead({ company }: { company: ProfessionalPrintModel["company"] }) {
  return (
    <div className="pp-letterhead">
      {company.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- print/PDF; logo from settings storage
        <img className="pp-logo" src={company.logoUrl} alt={company.registeredName} />
      ) : (
        <div className="pp-company-name">{company.registeredName || "—"}</div>
      )}
      {company.logoUrl && <div className="pp-company-name pp-company-name-sm">{company.registeredName}</div>}
      {company.tradeName ? <div className="pp-trade-name">{company.tradeName}</div> : null}
      <div className="pp-nonvat">{NON_VAT_LABEL}</div>
      {company.tin ? (
        <div>TIN {company.tin}</div>
      ) : (
        <div className="pp-missing">TIN: [not set — Add your TIN so it prints on documents]</div>
      )}
      {company.address ? (
        <div className="pp-pre">{company.address}</div>
      ) : (
        <div className="pp-missing">Address: [not set — Add your address so it prints on documents]</div>
      )}
      {(company.phone || company.email || company.website) && (
        <div className="pp-contact-bits">
          {[company.phone, company.email, company.website].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

function SignatoryBlock({ signatories }: { signatories: NonNullable<ProfessionalPrintModel["signatories"]> }) {
  return (
    <section className="pp-signatories" aria-label="Signatures">
      {signatories.map((s) => (
        <div key={s.role} className="pp-signatory">
          <div className="pp-sign-line" />
          <div className="pp-sign-role">{s.role}</div>
          <div className="pp-sign-name">{s.name?.trim() || "Name"}</div>
          <div className="pp-sign-date">Date</div>
        </div>
      ))}
    </section>
  );
}

export function ProfessionalPrintDocument({ doc }: { doc: ProfessionalPrintModel }) {
  const unitLabel = doc.unitPriceLabel ?? "Unit price";
  const hideAmounts = !!doc.hideLineAmounts;
  return (
    <article
      className={`pp-page pp-paper-${doc.paperSize.toLowerCase()}`}
      aria-label={`${doc.title} ${doc.number}`}
      data-print-kind={doc.kind}
    >
      {doc.watermark && (
        <div className="pp-watermark" aria-hidden="true">
          {doc.watermark}
        </div>
      )}

      <header className="pp-head">
        <CompanyLetterhead company={doc.company} />
        <div className="pp-title-block">
          <h1>{doc.title}</h1>
          <table className="pp-meta">
            <tbody>
              <tr>
                <th>No.</th>
                <td>{doc.number}</td>
              </tr>
              <tr>
                <th>Date</th>
                <td>{doc.date}</td>
              </tr>
              <tr>
                <th>Status</th>
                <td>{doc.status}</td>
              </tr>
              {doc.meta.map((m) => (
                <tr key={`${m.label}-${m.value}`}>
                  <th>{m.label}</th>
                  <td>{m.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </header>

      <section className="pp-party" aria-label={doc.party.label}>
        <div className="pp-label">{doc.party.label}</div>
        <div className="pp-strong">{doc.party.name}</div>
        {doc.party.tin && <div>TIN {doc.party.tin}</div>}
        {doc.party.billingAddress && (
          <div>
            <span className="pp-label-inline">Billing: </span>
            <span className="pp-pre">{doc.party.billingAddress}</span>
          </div>
        )}
        {doc.party.deliveryAddress && (
          <div>
            <span className="pp-label-inline">Delivery: </span>
            <span className="pp-pre">{doc.party.deliveryAddress}</span>
          </div>
        )}
        {(doc.party.contactPerson || doc.party.phone || doc.party.email) && (
          <div className="pp-party-contact">
            {doc.party.contactPerson && <div className="pp-strong">{doc.party.contactPerson}</div>}
            {[doc.party.phone, doc.party.email].filter(Boolean).join(" · ")}
          </div>
        )}
      </section>

      {doc.items && (
        <table className="pp-items">
          <thead>
            <tr>
              <th>#</th>
              <th>Item / Description</th>
              <th className="num">Qty</th>
              <th>Unit</th>
              {!hideAmounts && <th className="num">{unitLabel}</th>}
              {!hideAmounts && <th className="num">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {doc.items.map((i, n) => (
              <tr key={n}>
                <td>{n + 1}</td>
                <td className="pp-pre">{i.description}</td>
                <td className="num">{qty(i.qty)}</td>
                <td>{i.unit}</td>
                {!hideAmounts && <td className="num">{formatPeso(i.unitPrice)}</td>}
                {!hideAmounts && <td className="num">{formatPeso(i.amount)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {doc.ledger && (
        <table className="pp-items pp-ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="num">Charges</th>
              <th className="num">Credits</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4}>Opening balance</td>
              <td className="num">{formatPeso(doc.ledger.openingBalance)}</td>
            </tr>
            {doc.ledger.lines.map((line, n) => (
              <tr key={n}>
                <td>{line.date}</td>
                <td className="pp-pre">{line.description}</td>
                <td className="num">{line.charges ? formatPeso(line.charges) : "—"}</td>
                <td className="num">{line.credits ? formatPeso(line.credits) : "—"}</td>
                <td className="num">{formatPeso(line.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4}>Closing balance</th>
              <th className="num">{formatPeso(doc.ledger.closingBalance)}</th>
            </tr>
          </tfoot>
        </table>
      )}

      {doc.ledger?.aging && doc.ledger.aging.length > 0 && (
        <section className="pp-aging" aria-label="Aging">
          <div className="pp-label">Aging</div>
          <div className="pp-aging-grid">
            {doc.ledger.aging.map((a) => (
              <div key={a.label}>
                <div className="pp-label">{a.label}</div>
                <div className="num">{formatPeso(a.amount)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {doc.totals && (
        <table className="pp-totals">
          <tbody>
            {doc.totals.map((t) => (
              <tr key={t.label} className={t.emphasize ? "pp-total-emph" : undefined}>
                <th>{t.label}</th>
                <td className="num">{formatPeso(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {doc.totalInWords && (
        <p className="pp-words">
          <span className="pp-label-inline">Amount in words: </span>
          {doc.totalInWords}
        </p>
      )}

      {(doc.terms || doc.validity || doc.notes || doc.deliveryNotes || doc.warrantyNotes) && (
        <section className="pp-notes">
          {doc.terms && (
            <div>
              <span className="pp-label-inline">Terms: </span>
              {doc.terms}
            </div>
          )}
          {doc.validity && (
            <div>
              <span className="pp-label-inline">Validity: </span>
              {doc.validity}
            </div>
          )}
          {doc.deliveryNotes && (
            <div>
              <span className="pp-label-inline">Delivery: </span>
              <span className="pp-pre">{doc.deliveryNotes}</span>
            </div>
          )}
          {doc.warrantyNotes && (
            <div>
              <span className="pp-label-inline">Warranty: </span>
              <span className="pp-pre">{doc.warrantyNotes}</span>
            </div>
          )}
          {doc.notes && <div className="pp-pre">{doc.notes}</div>}
        </section>
      )}

      {doc.paymentInstructions && doc.paymentInstructions.length > 0 && (
        <section className="pp-pay" aria-label="Payment instructions">
          <div className="pp-label">Payment instructions</div>
          <ul>
            {doc.paymentInstructions.map((p, i) => (
              <li key={i}>
                {p.kind === "bank" ? "Bank" : "E-wallet"}: {p.label} · {p.accountName} · {p.accountPrinted}
              </li>
            ))}
          </ul>
        </section>
      )}

      {doc.ewtNote && <p className="pp-ewt-note">{doc.ewtNote}</p>}

      {doc.signatories && doc.signatories.length > 0 && <SignatoryBlock signatories={doc.signatories} />}

      <footer className="pp-foot">
        <div className="pp-foot-main">
          {doc.thankYou && <div className="pp-thank-you">Thank you for your business</div>}
          {doc.taxLines.map((line) => (
            <div key={line} className="pp-tax-line">
              {line}
            </div>
          ))}
          <div className="pp-contact-line">{doc.contactLine}</div>
          {doc.termsUrl && <div className="pp-faint">Terms and conditions: {doc.termsUrl}</div>}
        </div>
        {doc.qrSvg && (
          <div className="pp-qr" role="img" aria-label="QR code" dangerouslySetInnerHTML={{ __html: doc.qrSvg }} />
        )}
        <div className="pp-page-num" aria-hidden="true" />
      </footer>
    </article>
  );
}
