import { describe, expect, it } from "vitest";
import {
  quoteApprovalBackfill,
  quoteMoneyFieldsChanged,
  quoteNotApprovedError,
  QUOTE_APPROVAL_LABELS,
} from "@/lib/quotes/approval";
import { canApprove, roleFlags, type PermissionUser } from "@/lib/permissions";

function user(roles: ("ADMIN" | "APPROVER" | "STAFF" | "VIEWER")[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

describe("quoteApprovalBackfill (migration mapping)", () => {
  it("maps DRAFT → PENDING and every non-draft → APPROVED", () => {
    expect(quoteApprovalBackfill("DRAFT")).toBe("PENDING");
    expect(quoteApprovalBackfill("SENT")).toBe("APPROVED");
    expect(quoteApprovalBackfill("WON")).toBe("APPROVED");
    expect(quoteApprovalBackfill("LOST")).toBe("APPROVED");
    expect(quoteApprovalBackfill("VOID")).toBe("APPROVED");
  });
});

describe("quote approval gates", () => {
  it("blocks send/email/convert until APPROVED", () => {
    expect(quoteNotApprovedError("PENDING")).toMatch(/waiting for approval/i);
    expect(quoteNotApprovedError("REJECTED")).toMatch(/rejected/i);
    expect(quoteNotApprovedError("APPROVED")).toBeNull();
  });

  it("labels match staff-facing copy", () => {
    expect(QUOTE_APPROVAL_LABELS.PENDING).toBe("Waiting for approval");
    expect(QUOTE_APPROVAL_LABELS.APPROVED).toBe("Approved");
    expect(QUOTE_APPROVAL_LABELS.REJECTED).toBe("Rejected");
  });

  it("Staff and Viewer cannot approve; Admin and Approver can", () => {
    expect(canApprove(user(["STAFF"]))).toBe(false);
    expect(canApprove(user(["VIEWER"]))).toBe(false);
    expect(canApprove(user(["APPROVER"]))).toBe(true);
    expect(canApprove(user(["ADMIN"]))).toBe(true);
  });
});

describe("quoteMoneyFieldsChanged", () => {
  const base = {
    contractPrice: "100.00",
    items: [{ qty: "1.00", unitPrice: "100.00", total: "100.00" }],
  };

  it("detects price / qty / total changes", () => {
    expect(quoteMoneyFieldsChanged(base, base)).toBe(false);
    expect(
      quoteMoneyFieldsChanged(base, {
        contractPrice: "100.00",
        items: [{ qty: "1.00", unitPrice: "110.00", total: "110.00" }],
      }),
    ).toBe(true);
    expect(
      quoteMoneyFieldsChanged(base, {
        contractPrice: "200.00",
        items: [{ qty: "2.00", unitPrice: "100.00", total: "200.00" }],
      }),
    ).toBe(true);
  });
});
