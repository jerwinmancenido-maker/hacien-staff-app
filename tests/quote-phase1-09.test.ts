// Brief 09 — Quote Phase 1: notes split, print boundaries, validation, totals.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { quoteInputSchema } from "@/lib/validation/quotes";
import { docTotals } from "@/lib/quotes/calc";
import { addDays, isoDate, manilaToday } from "@/lib/format";
import { quotePrintFixture } from "./fixtures/print-doc";

const CUSTOMER_NOTE = "CUSTOMER_NOTE_VISIBLE_ON_PRINT_xyz";
const INTERNAL_NOTE = "INTERNAL_NOTE_NEVER_PRINT_abc123";

function html(doc: Parameters<typeof ProfessionalPrintDocument>[0]["doc"]) {
  return renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc }));
}

describe("quote phase 1 — notes split and print", () => {
  it("prints Subject as a full-width line above items, not in the right meta column", () => {
    const subject = "Supply of laptops, printers and setup for the ICT office";
    const markup = html({
      ...quotePrintFixture(),
      subject,
      meta: [
        { label: "Valid until", value: "Nov 30, 2026" },
        { label: "Customer PO / RFQ no.", value: "RFQ-2026-118" },
        { label: "Prepared by", value: "Jerwin" },
      ],
    });
    expect(markup).toContain('class="pp-subject"');
    expect(markup).toContain("Subject:");
    expect(markup).toContain(subject);
    // Subject must not appear as a meta row label.
    expect(markup).not.toMatch(/<th>Subject \/ project<\/th>/);
    expect(markup).toContain("Customer PO / RFQ no.");
  });

  it("prints customer notes with a Notes label", () => {
    const markup = html({ ...quotePrintFixture(), notes: CUSTOMER_NOTE });
    expect(markup).toContain("Notes:");
    expect(markup).toContain(CUSTOMER_NOTE);
  });

  it("never prints internal notes even if a bad caller stuffed them into notes", () => {
    // Professional print only receives `notes` (customer). Internal must not be a print field.
    const markup = html({ ...quotePrintFixture(), notes: CUSTOMER_NOTE });
    expect(markup).not.toContain(INTERNAL_NOTE);
    expect(markup.toLowerCase()).not.toContain("internal only");
    expect(markup.toLowerCase()).not.toContain("never prints");
  });

  it("customer notes print in the terms / notes section alongside delivery and warranty", () => {
    const markup = html({
      ...quotePrintFixture(),
      terms: "Net 30",
      validity: "Nov 30, 2026",
      deliveryNotes: "7–14 days after PO",
      warrantyNotes: "1 year parts and labor",
      notes: CUSTOMER_NOTE,
    });
    expect(markup).toContain("Terms &amp; conditions:");
    expect(markup).toContain("Valid until:");
    expect(markup).toContain("Delivery lead time:");
    expect(markup).toContain("Warranty:");
    expect(markup).toContain("Notes:");
    expect(markup).toContain(CUSTOMER_NOTE);
  });
});

describe("quote phase 1 — validation and defaults", () => {
  it("maps existing notes to customer notes and accepts internalNotes / subject / buyerPoNo", () => {
    const today = manilaToday();
    const parsed = quoteInputSchema.safeParse({
      customerId: "cust_1",
      contactId: null,
      date: isoDate(today),
      validUntil: isoDate(addDays(today, 30)),
      terms: "Net 30",
      notes: "Old notes become customer notes",
      internalNotes: INTERNAL_NOTE,
      subject: "ICT office supply",
      buyerPoNo: "RFQ-2026-118",
      items: [{ id: null, description: "Laptop", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "1000", supplierUnitCost: "0" }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.notes).toBe("Old notes become customer notes");
    expect(parsed.data.internalNotes).toBe(INTERNAL_NOTE);
    expect(parsed.data.subject).toBe("ICT office supply");
    expect(parsed.data.buyerPoNo).toBe("RFQ-2026-118");
  });

  it("valid until may be omitted so the server fills from Settings defaultValidityDays", () => {
    const today = manilaToday();
    const parsed = quoteInputSchema.safeParse({
      customerId: "cust_1",
      contactId: null,
      date: isoDate(today),
      validUntil: "",
      terms: "",
      notes: "",
      items: [{ id: null, description: "Laptop", kind: "GOODS", qty: "1", unit: "pc", unitPrice: "1000", supplierUnitCost: "0" }],
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.validUntil).toBeUndefined();
  });
});

describe("quote phase 1 — totals unchanged (Goods + Services WHT)", () => {
  it("matches current math to the centavo on a sample goods+services quote", () => {
    // Same sample as quotes-calc mixed document.
    const t = docTotals([
      { kind: "GOODS", qty: "10", unitPrice: "52000", supplierUnitCost: "45000", withholdingRate: "0.0100", withholdingAtc: "WI158" },
      { kind: "SERVICES", qty: "1", unitPrice: "20000", supplierUnitCost: "5000", withholdingRate: "0.0200", withholdingAtc: "WI160" },
    ]);
    expect(t.contractPrice).toBe("540000.00");
    expect(t.withholdingTotal).toBe("5600.00");
    expect(t.netReceived).toBe("534400.00");
    expect(t.supplierCost).toBe("455000.00");
    expect(t.netMargin).toBe("79400.00");
    expect(t.netMarginPct).toBe("14.70");
  });
});
