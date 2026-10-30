import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { rrPrintFixture, rrPrintWithCostsFixture } from "./fixtures/print-doc";

function html(doc: Parameters<typeof ProfessionalPrintDocument>[0]["doc"]) {
  return renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc }));
}

describe("receiving report print costs", () => {
  it("defaults the show-costs setting OFF", () => {
    expect(DEFAULT_SETTINGS.print.showReceivingReportCosts).toBe(false);
  });

  it("hides unit cost and amounts by default", () => {
    const markup = html(rrPrintFixture()).toLowerCase();
    expect(markup).toContain("receiving report");
    expect(markup).toContain(">10<");
    expect(markup).not.toContain("unit cost");
    expect(markup).not.toContain("₱40,000");
    expect(markup).not.toContain("₱400,000");
  });

  it("shows unit cost and amounts when the setting is ON for a cost-view print", () => {
    const markup = html(rrPrintWithCostsFixture());
    expect(markup).toContain("Unit cost");
    expect(markup).toContain("₱40,000.00");
    expect(markup).toContain("₱400,000.00");
  });
});
