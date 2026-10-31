// Staff UX copy pass: feature-off page, list row hrefs, withholding form labels,
// print missing-field warnings.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode; [k: string]: unknown }) =>
    createElement("a", { href, ...rest }, children),
}));

import { FeatureOffPage, featureOffMessage } from "@/components/FeatureOff";
import { DataTable } from "@/components/DataTable";
import { PrintShell } from "@/components/docs/PrintShell";
import { WITHHOLDING_LABELS, WITHHOLDING_TYPES } from "@/lib/validation/companies";
import {
  WITHHOLDING_TYPE_FIELD_HINT,
  WITHHOLDING_TYPE_FIELD_LABEL,
  WITHHOLDING_TYPE_FORM_LABELS,
  WITHHOLDING_TYPE_FORM_ORDER,
  withholdingTypeFieldHint,
} from "@/lib/withholding/display";
import { missingFieldsPrintConfirm, missingFieldsPrintWarning } from "@/lib/print/company";
import { quotePrintFixture } from "./fixtures/print-doc";

describe("feature-off page", () => {
  it("names the feature and points staff to Settings > Features", () => {
    expect(featureOffMessage("Books")).toBe(
      "This part (Books) is turned off. Ask your admin to turn it on in Settings > Features.",
    );
    expect(featureOffMessage("Cash")).toContain("(Cash)");
    expect(featureOffMessage("Payables")).toContain("(Payables)");

    const html = renderToStaticMarkup(createElement(FeatureOffPage, { feature: "Books" }));
    expect(html).toContain("This part (Books) is turned off");
    expect(html).toContain("Settings &gt; Features");
    expect(html).toContain('href="/settings?tab=features"');
    expect(html).not.toContain("404");
  });
});

describe("list row links", () => {
  it("renders a real anchor href on DataTable rows so open-in-new-tab works", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, {
        label: "Quotes",
        columns: [{ key: "number", label: "QT no." }],
        rows: [
          {
            id: "q1",
            href: "/quotes/q1",
            cells: { number: "QT-2026-0001" },
            sort: { number: "QT-2026-0001" },
          },
        ],
      }),
    );
    expect(html).toContain('href="/quotes/q1"');
    expect(html).toContain("row-stretched-link");
    expect(html).toContain("QT-2026-0001");
  });
});

describe("customer withholding chip label", () => {
  it("uses No withholding instead of None on chips/lists", () => {
    expect(WITHHOLDING_LABELS.NONE).toBe("No withholding");
  });
});

describe("customer withholding form options", () => {
  it("maps plain option labels to the existing stored enum values", () => {
    expect(WITHHOLDING_TYPE_FIELD_LABEL).toBe("Does this customer withhold tax from your payment?");
    expect(WITHHOLDING_TYPE_FIELD_HINT).toBe("They'll give you a BIR 2307");
    expect(WITHHOLDING_TYPE_FORM_LABELS.NONE).toBe("No, pays in full (most customers)");
    expect(WITHHOLDING_TYPE_FORM_LABELS.TOP_WITHHOLDING_AGENT).toBe(
      "Yes, Top Withholding Agent (big company tagged by BIR)",
    );
    expect(WITHHOLDING_TYPE_FORM_LABELS.GOVERNMENT).toBe("Yes, Government office");
    expect(WITHHOLDING_TYPE_FORM_ORDER).toEqual(["NONE", "TOP_WITHHOLDING_AGENT", "GOVERNMENT"]);
    expect([...WITHHOLDING_TYPES].sort()).toEqual(["GOVERNMENT", "NONE", "TOP_WITHHOLDING_AGENT"]);
  });

  it("does not rename stored withholding type values", () => {
    expect(WITHHOLDING_TYPES).toEqual(["GOVERNMENT", "TOP_WITHHOLDING_AGENT", "NONE"]);
    for (const key of WITHHOLDING_TYPES) {
      expect(Object.prototype.hasOwnProperty.call(WITHHOLDING_TYPE_FORM_LABELS, key)).toBe(true);
    }
  });

  it("shows the BIR 2307 hint only for TWA or Government, never for pays-in-full", () => {
    expect(withholdingTypeFieldHint("")).toBeNull();
    expect(withholdingTypeFieldHint("NONE")).toBeNull();
    expect(withholdingTypeFieldHint("TOP_WITHHOLDING_AGENT")).toBe("They'll give you a BIR 2307");
    expect(withholdingTypeFieldHint("GOVERNMENT")).toBe("They'll give you a BIR 2307");
  });
});

describe("print missing-fields warning names only what is missing", () => {
  function alertText(missing: string[]) {
    const html = renderToStaticMarkup(
      createElement(PrintShell, {
        backHref: "/quotes/q1",
        doc: quotePrintFixture(),
        missing,
        canManageSettings: true,
      }),
    );
    const m = html.match(/role="status"><b>([^<]*)<\/b>/);
    return { html, alert: m?.[1] ?? "" };
  }

  it("TIN only", () => {
    expect(missingFieldsPrintWarning(["TIN"])).toBe("Add your TIN so it prints on documents.");
    expect(missingFieldsPrintConfirm(["TIN"])).toBe("TIN is missing. Print anyway?");
    const { html, alert } = alertText(["TIN"]);
    expect(alert).toBe("Add your TIN so it prints on documents.");
    expect(alert.toLowerCase()).not.toContain("address");
    expect(html).toContain('href="/settings?tab=print"');
  });

  it("address only", () => {
    expect(missingFieldsPrintWarning(["address"])).toBe("Add your address so it prints on documents.");
    expect(missingFieldsPrintConfirm(["address"])).toBe("Address is missing. Print anyway?");
    const { alert } = alertText(["address"]);
    expect(alert).toBe("Add your address so it prints on documents.");
    expect(alert).not.toContain("TIN");
  });

  it("TIN and address both", () => {
    expect(missingFieldsPrintWarning(["TIN", "address"])).toBe(
      "Add your TIN and address so they print on documents.",
    );
    expect(missingFieldsPrintConfirm(["TIN", "address"])).toBe("TIN and address are missing. Print anyway?");
    const { html, alert } = alertText(["TIN", "address"]);
    expect(alert).toBe("Add your TIN and address so they print on documents.");
    expect(html).toContain("Settings");
  });
});
