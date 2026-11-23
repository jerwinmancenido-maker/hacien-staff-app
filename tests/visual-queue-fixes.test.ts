import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readableDiffValue } from "@/components/DiffView";
import { ApplyCreditForm } from "@/components/billing/ApplyCreditForm";

describe("breadcrumb labels", () => {
  it("ends the trail at the section name for a record id with no supplied label (finding 1113)", async () => {
    const { breadcrumbLabelsForPath } = await import("@/components/Sidebar");
    expect(breadcrumbLabelsForPath("/quotes/cmwl1hxt000073ytuboqn00gz")).toEqual(["Quotes"]);
    expect(breadcrumbLabelsForPath("/customers/cmwl1ea7d00003ytuknnigyx1/edit")).toEqual(["Customers", "Edit"]);
    expect(breadcrumbLabelsForPath("/quotes")).toEqual(["Quotes"]);
  });

  it("shows the record's own label when the page supplies one (finding 1113)", async () => {
    const { breadcrumbLabelsForPath } = await import("@/components/Sidebar");
    expect(breadcrumbLabelsForPath("/quotes/cmwl1hxt000073ytuboqn00gz", "QT-2026-0038")).toEqual(["Quotes", "QT-2026-0038"]);
    expect(breadcrumbLabelsForPath("/customers/cmwl1ea7d00003ytuknnigyx1", "Juan Dela Cruz")).toEqual(["Customers", "Juan Dela Cruz"]);
  });

  it("keeps the Record fallback for short unknown segments", async () => {
    const { breadcrumbLabelsForPath } = await import("@/components/Sidebar");
    expect(breadcrumbLabelsForPath("/quotes/abc")).toEqual(["Quotes", "Record"]);
  });
});

describe("settings change log values", () => {
  it("renders a banks list in plain words, never [object Object]", () => {
    const out = readableDiffValue([
      { bankName: "Union Bank of the Philippines", accountName: "HACIEN INFORMATION TECHNOLOGY SOLUTIONS", accountLast4: "1177", printFullAccountNumber: false },
    ]);
    expect(out).toContain("Union Bank of the Philippines");
    expect(out).toContain("1177");
    expect(out).not.toContain("[object Object]");
  });
});

describe("ApplyCreditForm settled billing", () => {
  it("shows nothing on a paid billing even when the customer has no credit", () => {
    const html = renderToStaticMarkup(
      createElement(ApplyCreditForm, {
        customerId: "cust-1",
        availableCredit: "0.00",
        lockedBillingId: "bill-1",
        billings: [{ id: "bill-1", label: "Booklet #9", balance: "0.00" }],
      }),
    );
    expect(html).not.toContain("No customer credit to apply");
    expect(html).not.toContain("No open billing balance");
  });

  it("keeps the no-credit hint on an open billing", () => {
    const html = renderToStaticMarkup(
      createElement(ApplyCreditForm, {
        customerId: "cust-1",
        availableCredit: "0.00",
        lockedBillingId: "bill-1",
        billings: [{ id: "bill-1", label: "Booklet #9", balance: "500.00" }],
      }),
    );
    expect(html).toContain("No customer credit to apply");
  });
});
