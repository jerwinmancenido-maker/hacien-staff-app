// Entity fixes (REQ-HACIEN-MAC-TEST-004 follow-ups, PR-9), unit side:
// E1 — the Businesses toggle form must send values the shared bool()
// parser accepts, or "Switch on" silently saves OFF again.
// E15 — the Convert dialog says the sales order will carry the tag.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BusinessesForm } from "@/app/(app)/settings/BusinessesForm";
import { ConvertDialog } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";

const noopAction = async (_state: FormState, _form: FormData): Promise<FormState> => ({});

describe("E1 businesses toggle sends parser-accepted values", () => {
  const html = renderToStaticMarkup(
    createElement(BusinessesForm, {
      ownCompanyName: "HACIEN",
      businesses: [
        { id: "b-on", name: "Active Biz", shortLabel: "AB", active: true, sortOrder: 1 },
        { id: "b-off", name: "Dormant Biz", shortLabel: "DB", active: false, sortOrder: 2 },
      ],
      saveAction: noopAction,
      toggleAction: noopAction,
    }),
  );

  it("the switched-off business's toggle sends active=true (bool() accepts on/true/yes)", () => {
    expect(html).toContain('name="active" value="true"');
    expect(html).toContain("Switch on");
  });

  it("the active business's toggle sends active=false", () => {
    expect(html).toContain('name="active" value="false"');
    expect(html).toContain("Switch off");
  });

  it("no toggle sends the old 1/0 values bool() misread", () => {
    expect(html).not.toContain('name="active" value="1"');
    expect(html).not.toContain('name="active" value="0"');
  });
});

describe("E15 convert dialog names the tagged business", () => {
  const base = {
    number: "QT-2026-0014",
    defaultAddress: "1 Test St",
    addressOptions: [{ id: "a1", label: "Delivery: 1 Test St", text: "1 Test St" }],
    onClose: () => {},
    onConvert: async () => ({}),
  };

  it("shows the note when the quote is tagged", () => {
    const html = renderToStaticMarkup(createElement(ConvertDialog, { ...base, businessName: "MacTest Other Biz 2" }));
    expect(html).toContain("The sales order will belong to");
    expect(html).toContain("MacTest Other Biz 2");
  });

  it("shows no note for an own-company quote", () => {
    const html = renderToStaticMarkup(createElement(ConvertDialog, { ...base }));
    expect(html).not.toContain("The sales order will belong to");
  });
});
