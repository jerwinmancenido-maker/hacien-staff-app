// Shared professional A4/Letter print layout for every printable document.
// Customer docs must never show supplier costs/margins; supplier docs must never
// show customer selling prices. Tax wording comes only from lib/print/tax-wording.

import { formatPeso } from "@/lib/format";
import { BRAND_LETTERHEAD_LOGO } from "@/lib/print/company";
import { HIDE_STATUS_ON_PRINT, NON_VAT_LABEL } from "@/lib/print/tax-wording";
import { printablePersonName, printablePosition } from "@/lib/print/signatory";
import type { ProfessionalPrintModel, PrintSignatory } from "@/lib/print/types";

const qty = (q: string) => q.replace(/\.00$/, "");

function CompanyLetterhead({ company }: { company: ProfessionalPrintModel["company"] }) {
  // Prefer registered name for the text line; never treat this as a font stand-in for the logo.
  const companyLine = company.registeredName.trim() || company.tradeName.trim() || "—";
  const contactBits = [company.email?.trim(), company.phone?.trim()].filter(Boolean);
  // Settings upload overrides; otherwise brand kit logo-full.svg (SVG only — never retype HACIEN).
  const logoSrc = company.logoUrl?.trim() || BRAND_LETTERHEAD_LOGO;
  const isBrandLogo = logoSrc === BRAND_LETTERHEAD_LOGO || logoSrc.startsWith("/brand/");
  return (
    <div className="pp-letterhead">
      <div className="pp-letterhead-row">
        <div className="pp-logo-clearspace" title="Clear space = 2× blue square (≈2.2 mm at 45 mm width)">
          {/* eslint-disable-next-line @next/next/no-img-element -- print/PDF; brand kit SVG as-is */}
          <img
            className="pp-logo"
            src={logoSrc}
            alt={isBrandLogo ? "HACIEN" : companyLine}
            data-brand-logo={isBrandLogo ? "full" : "custom"}
          />
        </div>
        <div className="pp-letterhead-text">
          <div className="pp-company-line">{companyLine}</div>
          {/* Empty address/TIN: omit the line. Warning lives only in PrintShell toolbar. */}
          {company.address ? <div className="pp-pre">{company.address}</div> : null}
          <div className="pp-tin-row">
            {company.tin ? <span>TIN {company.tin}</span> : null}
            <span className="pp-nonvat">{NON_VAT_LABEL}</span>
          </div>
          {contactBits.length > 0 && <div className="pp-contact-bits">{contactBits.join(" · ")}</div>}
        </div>
      </div>
    </div>
  );
}

function PartyBoxes({ party, kind }: { party: ProfessionalPrintModel["party"]; kind: ProfessionalPrintModel["kind"] }) {
  const customerDoc = kind === "quote" || kind === "sales_order" || kind === "billing" || kind === "collection" || kind === "customer_statement";
  if (!customerDoc) {
    return (
      <section className="pp-party-grid" aria-label={party.label}>
        <div className="pp-party-box">
          <div className="pp-label">{party.label}</div>
          <div className="pp-strong">{party.name}</div>
          {party.contactPerson && (
            <div>
              <span className="pp-label-inline">Attn: </span>
              {party.contactPerson}
              {(party.phone || party.email) && (
                <span className="pp-party-contact-bits">
                  {" "}
                  · {[party.phone, party.email].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
          )}
          {party.billingAddress && <div className="pp-pre">{party.billingAddress}</div>}
          {party.tin && <div>TIN {party.tin}</div>}
        </div>
        <div className="pp-party-box">
          <div className="pp-label">Deliver to</div>
          {party.deliveryAddress ? <div className="pp-pre">{party.deliveryAddress}</div> : <div className="pp-faint">—</div>}
        </div>
      </section>
    );
  }

  return (
    <section className="pp-party-grid" aria-label="Bill to and Deliver to">
      <div className="pp-party-box">
        <div className="pp-label">Bill to</div>
        <div className="pp-strong">{party.name}</div>
        {party.contactPerson && (
          <div>
            <span className="pp-label-inline">Attn: </span>
            {party.contactPerson}
            {(party.phone || party.email) && (
              <span className="pp-party-contact-bits"> · {[party.phone, party.email].filter(Boolean).join(" · ")}</span>
            )}
          </div>
        )}
        {party.billingAddress && <div className="pp-pre">{party.billingAddress}</div>}
        {party.tin && <div>TIN {party.tin}</div>}
      </div>
      <div className="pp-party-box">
        <div className="pp-label">Deliver to</div>
        {party.deliveryAddress ? (
          <div className="pp-pre">{party.deliveryAddress}</div>
        ) : (
          <div className="pp-faint">—</div>
        )}
      </div>
    </section>
  );
}

function SignatoryBlock({ signatories }: { signatories: PrintSignatory[] }) {
  return (
    <section className="pp-signatories" aria-label="Signatures">
      {signatories.map((s) => {
        const name = printablePersonName(s.name);
        const position = printablePosition(s.position);
        return (
          <div key={s.role} className="pp-signatory">
            <div className="pp-sign-line" aria-hidden="true" />
            <div className="pp-sign-role">{s.role}</div>
            <div className="pp-sign-name">{name ?? "\u00a0"}</div>
            {s.role === "Prepared by" && <div className="pp-sign-position">{position ?? "\u00a0"}</div>}
            {s.role === "Conforme" && (
              <>
                <div className="pp-sign-name-hint">Printed name</div>
                <div className="pp-sign-date">Date</div>
              </>
            )}
            {s.role !== "Conforme" && s.role !== "Prepared by" && <div className="pp-sign-date">Date</div>}
          </div>
        );
      })}
    </section>
  );
}

export function ProfessionalPrintDocument({ doc }: { doc: ProfessionalPrintModel }) {
  const unitLabel = doc.unitPriceLabel ?? "Unit price";
  const hideAmounts = !!doc.hideLineAmounts;
  const hideStatus = doc.hideStatus ?? HIDE_STATUS_ON_PRINT.has(doc.kind);
  const numberLabel =
    doc.kind === "quote" ? "Quote no." : doc.kind === "sales_order" ? "SO no." : doc.kind === "billing" ? "Billing no." : "No.";

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
          <h1>
            <span className="pp-title-pixel" aria-hidden="true" />
            {doc.title}
          </h1>
          <table className="pp-meta">
            <tbody>
              <tr>
                <th>{numberLabel}</th>
                <td>{doc.number}</td>
              </tr>
              <tr>
                <th>Date</th>
                <td>{doc.date}</td>
              </tr>
              {hideStatus ? null : (
                <tr className="pp-status-row">
                  <th>Status</th>
                  <td>{doc.status}</td>
                </tr>
              )}
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

      <PartyBoxes party={doc.party} kind={doc.kind} />

      {doc.subject?.trim() ? (
        <p className="pp-subject">
          <span className="pp-label-inline">Subject: </span>
          {doc.subject.trim()}
        </p>
      ) : null}

      {doc.items && (
        <table className="pp-items">
          <thead>
            <tr>
              <th className="pp-n">#</th>
              <th className="pp-desc">Description</th>
              <th className="num pp-qty">Qty</th>
              <th className="pp-unit">Unit</th>
              {!hideAmounts && <th className="num">{unitLabel}</th>}
              {!hideAmounts && <th className="num">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {doc.items.map((i, n) => (
              <tr key={n}>
                <td className="pp-n">{n + 1}</td>
                <td className="pp-desc">
                  <div className="pp-pre">{i.description}</div>
                  {i.detail ? <div className="pp-item-detail pp-pre">{i.detail}</div> : null}
                </td>
                <td className="num pp-qty">{qty(i.qty)}</td>
                <td className="pp-unit">{i.unit}</td>
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

      <div className="pp-closing">
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
                <span className="pp-label-inline">Terms &amp; conditions: </span>
                {doc.terms}
              </div>
            )}
            {doc.validity && doc.kind === "quote" && (
              <div>
                <span className="pp-label-inline">Valid until: </span>
                {doc.validity}
              </div>
            )}
            {doc.deliveryNotes && (
              <div>
                <span className="pp-label-inline">Delivery lead time: </span>
                <span className="pp-pre">{doc.deliveryNotes}</span>
              </div>
            )}
            {doc.warrantyNotes && (
              <div>
                <span className="pp-label-inline">Warranty: </span>
                <span className="pp-pre">{doc.warrantyNotes}</span>
              </div>
            )}
            {doc.notes && (
              <div>
                <span className="pp-label-inline">Notes: </span>
                <span className="pp-pre">{doc.notes}</span>
              </div>
            )}
          </section>
        )}

        {doc.paymentInstructions && doc.paymentInstructions.length > 0 && (
          <section className="pp-pay" aria-label="Payment instructions">
            <div className="pp-label">Bank / e-wallet details</div>
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
      </div>

      <footer className="pp-foot">
        <div className="pp-foot-left">
          {doc.thankYou && <span className="pp-thank-you">Thank you for your business</span>}
          {doc.termsUrl && <span className="pp-faint">Terms: {doc.termsUrl}</span>}
          {doc.taxLines.map((line) => (
            <div key={line} className="pp-tax-line">
              {line}
            </div>
          ))}
        </div>
        <div className="pp-page-num" aria-hidden="true" />
        {doc.qrSvg ? (
          <div className="pp-qr" role="img" aria-label="QR code" dangerouslySetInnerHTML={{ __html: doc.qrSvg }} />
        ) : (
          <div className="pp-qr-spacer" aria-hidden="true" />
        )}
      </footer>
    </article>
  );
}
