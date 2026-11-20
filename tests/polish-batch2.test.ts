// Fix batch 2 PR-8 render coverage:
// - F18: the acceptance form's intro must not claim "No signed
//   conforme" when a conforme file is already on the quote.
// - F19: statement prints (customer + supplier) must not render an
//   empty "Deliver to" box; other documents keep theirs.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AcceptanceForm } from "@/components/docs/AcceptanceForm";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import type { FormState } from "@/lib/validation/forms";
import { billingPrintFixture, customerStatementFixture, supplierStatementFixture } from "./fixtures/print-doc";

const noopAction = async (): Promise<FormState> => ({ ok: false });

describe("F18 acceptance form intro", () => {
  it("without a conforme it explains acceptance is needed to convert", () => {
    const out = renderToStaticMarkup(createElement(AcceptanceForm, { action: noopAction }));
    expect(out).toContain("No signed conforme and no buyer PO yet");
  });

  it("with a conforme on file it says so and calls recording optional", () => {
    const out = renderToStaticMarkup(createElement(AcceptanceForm, { action: noopAction, hasConforme: true }));
    expect(out).toContain("A signed conforme is on file above");
    expect(out).not.toContain("No signed conforme and no buyer PO yet");
  });
});

describe("F19 statement prints have no empty Deliver to box", () => {
  const withNoDelivery = <T extends { party: { deliveryAddress: string | null } }>(doc: T): T => ({
    ...doc,
    party: { ...doc.party, deliveryAddress: null },
  });

  it("customer statement omits the box", () => {
    const out = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: withNoDelivery(customerStatementFixture()) }));
    expect(out).not.toContain(">Deliver to</div>");
  });

  it("supplier statement omits the box", () => {
    const out = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: withNoDelivery(supplierStatementFixture()) }));
    expect(out).not.toContain(">Deliver to</div>");
  });

  it("a billing print keeps the box (empty shows the dash)", () => {
    const out = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: withNoDelivery(billingPrintFixture()) }));
    expect(out).toContain(">Deliver to</div>");
  });
});
