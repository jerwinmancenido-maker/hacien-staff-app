import { describe, expect, it } from "vitest";
import { COST_NOT_SET_LABEL } from "@/lib/quotes/calc";
import { poApproveBlockedReason, poWaitsForApproval, visibleApprovalReasons } from "@/lib/approvals/rules";

// Approval inbox decision helpers (ERP adoption item 1). These mirror the
// document pages' rules; the tests pin the mirrors so the inbox can never
// drift into offering an action — or leaking a reason — the pages refuse.

describe("visibleApprovalReasons", () => {
  it("shows every reason to a cost viewer", () => {
    const out = visibleApprovalReasons(["Margin below 18%", COST_NOT_SET_LABEL], true);
    expect(out.reasons).toEqual(["Margin below 18%", COST_NOT_SET_LABEL]);
    expect(out.hidden).toBe(false);
  });

  it("hides the cost-not-set reason from a non-cost viewer and says so", () => {
    const out = visibleApprovalReasons(["Margin below 18%", COST_NOT_SET_LABEL], false);
    expect(out.reasons).toEqual(["Margin below 18%"]);
    expect(out.hidden).toBe(true);
  });

  it("reports nothing hidden when no cost reason exists", () => {
    const out = visibleApprovalReasons(["Total above ₱500,000"], false);
    expect(out.reasons).toEqual(["Total above ₱500,000"]);
    expect(out.hidden).toBe(false);
  });
});

describe("poWaitsForApproval", () => {
  it("waits only when the subtotal is strictly above the pinned limit", () => {
    expect(poWaitsForApproval("100000.01", 100_000)).toBe(true);
    expect(poWaitsForApproval("100000.00", 100_000)).toBe(false);
    expect(poWaitsForApproval("99999.99", 100_000)).toBe(false);
  });

  it("fails closed when the pinned settings version is missing", () => {
    expect(poWaitsForApproval("1.00", null)).toBe(true);
  });
});

describe("poApproveBlockedReason", () => {
  it("blocks an Approver from approving their own PO", () => {
    expect(poApproveBlockedReason({ id: "u1", isAdmin: false }, "u1")).toMatch(/other than the creator/);
  });

  it("lets an Admin approve their own PO", () => {
    expect(poApproveBlockedReason({ id: "u1", isAdmin: true }, "u1")).toBeNull();
  });

  it("lets an Approver approve someone else's PO", () => {
    expect(poApproveBlockedReason({ id: "u1", isAdmin: false }, "u2")).toBeNull();
  });
});
