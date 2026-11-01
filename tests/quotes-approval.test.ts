import { describe, expect, it } from "vitest";
import {
  quoteApprovalBackfill,
  quoteMoneyFieldsChanged,
  quoteNotApprovedError,
  QUOTE_APPROVAL_LABELS,
  type QuoteMoneyLine,
  type QuoteMoneySnapshot,
} from "@/lib/quotes/approval";
import { canApprove, roleFlags, type PermissionUser } from "@/lib/permissions";

function user(roles: ("ADMIN" | "APPROVER" | "STAFF" | "VIEWER")[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

function line(partial: Partial<QuoteMoneyLine> & Pick<QuoteMoneyLine, "id">): QuoteMoneyLine {
  return {
    qty: "1.00",
    unitPrice: "100.00",
    total: "100.00",
    supplierUnitCost: "40.00",
    supplierTotal: "40.00",
    withholdingRate: null,
    withholdingAtc: null,
    ...partial,
  };
}

function snap(partial: Partial<QuoteMoneySnapshot> = {}): QuoteMoneySnapshot {
  return {
    contractPrice: "100.00",
    withholdingTotal: "0.00",
    netReceived: "100.00",
    supplierCost: "40.00",
    netMargin: "60.00",
    netMarginPct: "60.00",
    withholdingKey: "",
    items: [line({ id: "a" })],
    ...partial,
  };
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
  it("detects price / qty / total changes", () => {
    const base = snap();
    expect(quoteMoneyFieldsChanged(base, base)).toBe(false);
    expect(
      quoteMoneyFieldsChanged(
        base,
        snap({
          contractPrice: "110.00",
          netReceived: "110.00",
          netMargin: "70.00",
          netMarginPct: "63.64",
          items: [line({ id: "a", unitPrice: "110.00", total: "110.00" })],
        }),
      ),
    ).toBe(true);
    expect(
      quoteMoneyFieldsChanged(
        base,
        snap({
          contractPrice: "200.00",
          netReceived: "200.00",
          supplierCost: "40.00",
          netMargin: "160.00",
          netMarginPct: "80.00",
          items: [line({ id: "a", qty: "2.00", total: "200.00" })],
        }),
      ),
    ).toBe(true);
  });

  it("detects supplier cost and withholding-only changes", () => {
    const base = snap();
    expect(
      quoteMoneyFieldsChanged(
        base,
        snap({
          supplierCost: "50.00",
          netMargin: "50.00",
          netMarginPct: "50.00",
          items: [line({ id: "a", supplierUnitCost: "50.00", supplierTotal: "50.00" })],
        }),
      ),
    ).toBe(true);
    expect(
      quoteMoneyFieldsChanged(
        base,
        snap({
          withholdingTotal: "5.00",
          netReceived: "95.00",
          netMargin: "55.00",
          netMarginPct: "57.89",
          withholdingKey: "WI010:0.05",
          items: [line({ id: "a", withholdingRate: "0.0500", withholdingAtc: "WI010" })],
        }),
      ),
    ).toBe(true);
  });

  it("reordering the same line ids is not a money change; new/removed lines are", () => {
    const a = line({ id: "a", qty: "1.00", unitPrice: "100.00", total: "100.00" });
    const b = line({
      id: "b",
      qty: "2.00",
      unitPrice: "50.00",
      total: "100.00",
      supplierUnitCost: "20.00",
      supplierTotal: "40.00",
    });
    const before = snap({
      contractPrice: "200.00",
      netReceived: "200.00",
      supplierCost: "80.00",
      netMargin: "120.00",
      netMarginPct: "60.00",
      items: [a, b],
    });
    const reordered = snap({
      contractPrice: "200.00",
      netReceived: "200.00",
      supplierCost: "80.00",
      netMargin: "120.00",
      netMarginPct: "60.00",
      items: [b, a],
    });
    expect(quoteMoneyFieldsChanged(before, reordered)).toBe(false);

    const withNew = snap({
      contractPrice: "300.00",
      netReceived: "300.00",
      supplierCost: "80.00",
      netMargin: "220.00",
      netMarginPct: "73.33",
      items: [a, b, line({ id: null, qty: "1.00", unitPrice: "100.00", total: "100.00" })],
    });
    expect(quoteMoneyFieldsChanged(before, withNew)).toBe(true);

    const removed = snap({
      contractPrice: "100.00",
      netReceived: "100.00",
      supplierCost: "40.00",
      netMargin: "60.00",
      netMarginPct: "60.00",
      items: [a],
    });
    expect(quoteMoneyFieldsChanged(before, removed)).toBe(true);
  });
});
