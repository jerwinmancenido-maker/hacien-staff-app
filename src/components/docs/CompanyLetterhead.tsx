// Shared company letterhead for every print: the 10 professional documents
// (via ProfessionalPrintDocument) and the 5 book/tax prints (via their own
// pages) all render this one component, so the letterhead cannot drift
// between prints. S-86, option A: book/tax prints adopt this existing
// letterhead; the 10 documents and their NON-VAT tag are unchanged.

import { BRAND_LETTERHEAD_LOGO } from "@/lib/print/company";
import { NON_VAT_LABEL } from "@/lib/print/tax-wording";
import type { ProfessionalPrintModel } from "@/lib/print/types";

export function CompanyLetterhead({ company }: { company: ProfessionalPrintModel["company"] }) {
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
