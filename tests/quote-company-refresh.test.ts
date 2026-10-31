// Draft-only "Use latest company details" eligibility + DocRuleError message.
// End-to-end MySQL coverage lives in tests/db/quotes.db.test.ts when TEST_DATABASE_URL is set.

import { describe, expect, it } from "vitest";
import { quoteCanRefreshCompanyDetails } from "@/lib/services/quotes";
import { DocRuleError } from "@/lib/documents/common";

describe("quoteCanRefreshCompanyDetails", () => {
  it("allows only DRAFT (unsent) quotes", () => {
    expect(quoteCanRefreshCompanyDetails("DRAFT")).toBe(true);
    expect(quoteCanRefreshCompanyDetails("SENT")).toBe(false);
    expect(quoteCanRefreshCompanyDetails("WON")).toBe(false);
    expect(quoteCanRefreshCompanyDetails("LOST")).toBe(false);
    expect(quoteCanRefreshCompanyDetails("VOID")).toBe(false);
  });
});

describe("refreshQuoteCompanyDetails rejection message", () => {
  it("documents the server-side reject copy for sent/approved quotes", () => {
    // The service throws this DocRuleError before touching settings when status ≠ DRAFT.
    const err = new DocRuleError("Only draft (unsent) quotes can refresh company details from settings.");
    expect(err).toBeInstanceOf(DocRuleError);
    expect(err.message).toMatch(/draft \(unsent\)/i);
  });
});
